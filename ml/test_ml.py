"""Quick self-test of the ML service: python ml/test_ml.py"""
import json, app as svc
c = svc.app.test_client()
ok = dict(commodity='Milk', dur_farm=1, dur_processing=1, dur_distribution=2, dur_retail=1, temp_dev_max=1, lab_score=92, handler_reputation=90)
bad = dict(commodity='Milk', dur_farm=4, dur_processing=6, dur_distribution=10, dur_retail=6, temp_dev_max=8, lab_score=55, handler_reputation=40)
odd = dict(commodity='Paddy', dur_farm=2000, dur_processing=2000, dur_distribution=2000, dur_retail=2000, temp_dev_max=25, lab_score=20, handler_reputation=10)
r = c.post('/predict', json={'rows': [ok, bad, odd]}).get_json()
for n, x in zip(['clean', 'risky', 'extreme'], r): print(n, json.dumps({k: x[k] for k in ['rf', 'xgb', 'lgbm', 'stack', 'risk', 'level', 'anomaly']}), [f"{q['label']} {'+' if q['direction']=='raises' else '-'}{abs(q['impact'])}" for q in x['reasons']])
assert r[0]['risk'] < 30 and r[1]['risk'] >= 60, 'risk ordering'
assert not r[0]['anomaly'] and r[2]['anomaly'], 'anomaly detection'
assert any(q['direction'] == 'raises' for q in r[1]['reasons']) and len(r[1]['reasons']) == 3, 'SHAP reasons'
rep = c.post('/reputation', json={'handlers': [dict(address='a', total=10, flagged=0), dict(address='b', total=10, flagged=5), dict(address='c', total=0, flagged=0)]}).get_json()
print('reputation', [x['reputation'] for x in rep]); assert rep[0]['reputation'] > rep[1]['reputation']
assert c.post('/predict', json={'x': 1}).status_code == 400
print('ML TESTS PASSED')
