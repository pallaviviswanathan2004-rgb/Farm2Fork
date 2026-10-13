"""Builds the supply-chain risk dataset and trains the ML stack:
   1. Random Forest, XGBoost, LightGBM   (base models)
   2. Stacking meta-learner               (logistic regression on the base models' out-of-fold predictions)
   3. Isotonic probability calibration    (so "70 %" really means about 70 %)
   4. Isolation Forest                    (unsupervised anomaly detector, needs no adulteration labels)
SHAP explanations are computed at prediction time in app.py.
Features: stage durations, max temperature deviation, lab score, handler reputation, commodity shelf life."""
import os, json, joblib, numpy as np, pandas as pd
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.isotonic import IsotonicRegression
from sklearn.model_selection import train_test_split, cross_val_predict, StratifiedKFold
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score, brier_score_loss
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, '..', 'datasets', 'supply_chain_risk.csv'); MD = os.path.join(HERE, 'models')
COMS = ['Groundnut','Turmeric','Paddy','Wheat','Maize','Milk','Mango','Coconut','Banana','Tomato','Sugarcane',
        'Red Chilli','Black Pepper','Cashew','Sesame','Mustard','Soybean','Honey','Tea','Coffee']
SHELF_H = {'Milk': 72, 'Mango': 240, 'Tomato': 240, 'Banana': 168, 'Sugarcane': 480}   # perishables (hours)
DURS = ['dur_farm','dur_processing','dur_distribution','dur_retail']
FEATS = ['shelf_life_h', *DURS, 'temp_dev_max','lab_score','handler_reputation']

def logit(p): p = np.clip(p, 1e-4, 1 - 1e-4); return np.log(p / (1 - p))

def anomaly_X(df):
    """Commodity-independent view for the anomaly detector: time used as a share of shelf life, temperature, lab, reputation."""
    shelf = df.shelf_life_h.values
    return pd.DataFrame({'time_share': df[DURS].sum(axis=1).values / shelf, 'temp': df.temp_dev_max.values,
                         'lab': df.lab_score.values, 'rep': df.handler_reputation.values})

def make(n=40000, seed=11):
    g = np.random.default_rng(seed); com = g.integers(0, len(COMS), n)
    shelf = np.array([SHELF_H.get(COMS[i], 4320) for i in com]); sc = shelf * .015
    d = {k: g.gamma(2, sc) for k in DURS}
    temp = np.abs(g.normal(1.5, 1.8, n)); lab = np.clip(g.normal(84, 11, n), 20, 100); rep = np.clip(g.normal(78, 14, n), 10, 100)
    ratio = sum(d.values()) / shelf
    z = -2.9 + .7 * temp + 6 * ratio * (1 + temp / 3) - .07 * (lab - 80) - .06 * (rep - 75) + g.normal(0, .35, n)
    y = (g.random(n) < 1 / (1 + np.exp(-z))).astype(int)
    df = pd.DataFrame({'commodity': [COMS[i] for i in com], 'shelf_life_h': shelf, **{k: v.round(1) for k, v in d.items()},
                       'temp_dev_max': temp.round(1), 'lab_score': lab.round(0), 'handler_reputation': rep.round(0), 'adulterated': y})
    df.insert(0, 'record_id', [f'R{i:06d}' for i in range(n)]); return df

def base_models():
    return {'rf': RandomForestClassifier(120, max_depth=12, n_jobs=-1, random_state=1),
            'xgb': XGBClassifier(n_estimators=300, max_depth=5, learning_rate=.08, subsample=.9, eval_metric='logloss', n_jobs=-1, random_state=1),
            'lgbm': LGBMClassifier(n_estimators=300, max_depth=6, learning_rate=.08, subsample=.9, subsample_freq=1, verbose=-1, n_jobs=-1, random_state=1)}

def score(y, p): return dict(accuracy=round(accuracy_score(y, p > .5), 3), f1=round(f1_score(y, p > .5), 3), auc=round(roc_auc_score(y, p), 3), brier=round(brier_score_loss(y, p), 4))

def train():
    os.makedirs(MD, exist_ok=True); df = make(); df.to_csv(CSV, index=False)
    X, y = df[FEATS], df.adulterated
    Xrest, Xte, yrest, yte = train_test_split(X, y, test_size=.25, random_state=1, stratify=y)
    Xtr, Xcal, ytr, ycal = train_test_split(Xrest, yrest, test_size=.2, random_state=2, stratify=yrest)     # 60 % train / 15 % calibration / 25 % test
    base = base_models(); cv = StratifiedKFold(5, shuffle=True, random_state=3)
    # stacking: meta-learner is trained on OUT-OF-FOLD predictions so it never sees a base model's own training fit
    oof = np.column_stack([logit(cross_val_predict(m, Xtr, ytr, cv=cv, method='predict_proba')[:, 1]) for m in base.values()])
    meta = LogisticRegression().fit(oof, ytr)
    for m in base.values(): m.fit(Xtr, ytr)
    P = lambda Xs: {k: m.predict_proba(Xs)[:, 1] for k, m in base.items()}
    stack = lambda Xs: meta.predict_proba(np.column_stack([logit(p) for p in P(Xs).values()]))[:, 1]
    iso = IsotonicRegression(out_of_bounds='clip').fit(stack(Xcal), ycal)                                  # calibration on held-out data
    anom = IsolationForest(n_estimators=200, contamination=.03, random_state=1).fit(anomaly_X(df.loc[Xtr.index]))
    pt = P(Xte); raw = stack(Xte); cal = iso.predict(raw)
    m = {k: score(yte, p) for k, p in pt.items()}
    m['simple_average'] = score(yte, np.mean(list(pt.values()), axis=0)); m['stacked'] = score(yte, raw); m['stacked_calibrated'] = score(yte, cal)
    flagged = (anom.predict(anomaly_X(df.loc[Xte.index])) == -1)
    joblib.dump(dict(rf=base['rf'], lgbm=base['lgbm'], meta=meta, iso=iso, anom=anom), os.path.join(MD, 'stack.joblib')); base['xgb'].save_model(os.path.join(MD, 'xgb.json'))
    json.dump(dict(features=FEATS, commodities=COMS, metrics=m, rows=len(df), adulterated_share=round(float(y.mean()), 3),
                   stack_weights=dict(zip(base, map(float, meta.coef_[0].round(3)))), anomaly_share_test=round(float(flagged.mean()), 3),
                   importance=dict(zip(FEATS, map(float, base['rf'].feature_importances_.round(3))))), open(os.path.join(MD, 'meta.json'), 'w'), indent=1)
    for k, v in m.items(): print(f'{k:20s}', v)
    print('rows', len(df), '| adulterated share', round(float(y.mean()), 3), '| anomalies flagged on test', round(float(flagged.mean()), 3))

if __name__ == '__main__': train()
