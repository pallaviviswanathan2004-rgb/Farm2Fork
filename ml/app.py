"""ML service. Run: python ml/app.py   (first start trains the models, under a minute)
POST /predict    {rows:[{commodity,dur_farm,...}]} -> stacked + calibrated risk, per-model scores, SHAP reasons, anomaly flag
POST /reputation {handlers:[{address,total,flagged}]} -> history-based reputation score 0-100"""
import os, json, joblib, numpy as np, pandas as pd, xgboost
from flask import Flask, request, jsonify
from xgboost import XGBClassifier
from train import train, MD, FEATS, COMS, SHELF_H, anomaly_X, logit

if not os.path.exists(os.path.join(MD, 'meta.json')): print('Training models (first run, under a minute)...'); train()
S = joblib.load(os.path.join(MD, 'stack.joblib')); xg = XGBClassifier(); xg.load_model(os.path.join(MD, 'xgb.json'))
meta = json.load(open(os.path.join(MD, 'meta.json'))); app = Flask(__name__)
LABEL = dict(shelf_life_h='Commodity shelf life', dur_farm='Time at farm', dur_processing='Time in processing', dur_distribution='Time in distribution',
             dur_retail='Time in retail', temp_dev_max='Temperature deviation', lab_score='Lab score', handler_reputation='Handler reputation')
try:
    import shap; EXPL = shap.TreeExplainer(xg)
except Exception: EXPL = None

def contribs(X):                                   # SHAP values (log-odds) of the XGBoost model; native Tree-SHAP is the fallback
    try:
        if EXPL is not None: return np.asarray(EXPL.shap_values(X))
    except Exception: pass
    return xgboost.Booster.predict(xg.get_booster(), xgboost.DMatrix(X), pred_contribs=True)[:, :-1]

lvl = lambda r: 'LOW' if r < 30 else 'MEDIUM' if r < 60 else 'HIGH'

@app.get('/health')
def health(): return jsonify(ok=True, **meta)

@app.post('/predict')
def predict():
    try:
        rows = request.get_json()['rows']
        X = pd.DataFrame([{**r, 'shelf_life_h': SHELF_H.get(r['commodity'], 4320)} for r in rows])[FEATS].astype(float)
    except Exception as e: return jsonify(error='bad input: ' + str(e)), 400
    pr = {'rf': S['rf'].predict_proba(X)[:, 1], 'xgb': xg.predict_proba(X)[:, 1], 'lgbm': S['lgbm'].predict_proba(X)[:, 1]}
    raw = S['meta'].predict_proba(np.column_stack([logit(p) for p in pr.values()]))[:, 1]
    cal = S['iso'].predict(raw); sv = contribs(X)
    A = anomaly_X(X); an = S['anom'].predict(A) == -1; asc = S['anom'].decision_function(A)
    out = []
    for i in range(len(X)):
        top = np.argsort(-np.abs(sv[i]))[:3]
        out.append(dict(rf=round(float(pr['rf'][i]) * 100), xgb=round(float(pr['xgb'][i]) * 100), lgbm=round(float(pr['lgbm'][i]) * 100),
                        stack=round(float(raw[i]) * 100), risk=int(round(float(cal[i]) * 100)), level=lvl(round(float(cal[i]) * 100)),
                        anomaly=bool(an[i]), anomaly_score=round(float(asc[i]), 3),
                        reasons=[dict(feature=FEATS[j], label=LABEL[FEATS[j]], value=round(float(X.iloc[i, j]), 1), impact=round(float(sv[i][j]), 2),
                                      direction='raises' if sv[i][j] > 0 else 'lowers') for j in top]))
    return jsonify(out)

@app.post('/reputation')
def reputation():
    """Bayesian reputation: prior flagged-rate 15 % worth 6 batches, updated with the handler's own record."""
    hs = request.get_json()['handlers']; prior, w = .15, 6
    return jsonify([dict(address=h['address'], reputation=int(round(100 * (1 - (h['flagged'] + prior * w) / (h['total'] + w))))) for h in hs])

if __name__ == '__main__': app.run(port=int(os.environ.get('ML_PORT', 5001)))
