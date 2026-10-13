// Farm2Fork front end: email authentication, role dashboards, read-only ethers.js blockchain access, relayed writes, ML risk, IPFS upload and QR verification.

const $ = s => document.querySelector(s);

const RN = ['None','Farmer','Processor','Distributor','Retailer','Consumer','Regulator'], ST = ['Farm','Processing','Distribution','Retail','Sold'];

const MOD = { dash:['Dashboard','◧'], reg:['Register batch','＋'], proc:['Processing','⚙'], move:['Transfers','⇄'], mon:['Risk & recall','◈'], roles:['Stakeholders','☰'], verify:['Verify & trace','⌕'] };

const ACC = { Farmer:['dash','reg','move','verify'], Processor:['dash','proc','move','verify'], Distributor:['dash','move','verify'], Retailer:['dash','move','verify'], Consumer:['verify'], Regulator:['dash','mon','roles','verify'], None:['verify'] };

const MNEMONIC = 'test test test test test test test test test test test junk', LOCAL = ['Regulator','Farmer','Processor','Distributor','Retailer','Consumer'];

let CFG, C, me, role, mod, pc = Object.keys(CAT)[0], vid = new URLSearchParams(location.search).get('batch') || '';

const sh = a => a.slice(0, 6) + '…' + a.slice(-4), lvl = p => p < 30 ? ['LOW','ok'] : p < 60 ? ['MEDIUM','warn'] : ['HIGH','bad'];
async function loadBlockchainUsers() {
  const token = sessionStorage.getItem('farm2fork_token');

  const response = await fetch(token ? '/api/blockchain/users' : '/api/blockchain/public-users', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    throw Error('Could not load blockchain users');
  }

  return (await response.json()).users;
}


async function api(path, options = {}) {
  const token = sessionStorage.getItem('farm2fork_token');
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}

function userLabel(hash, users) {
  const u = users.find(x => x.blockchainId.toLowerCase() === String(hash).toLowerCase());
  return u ? `${u.name} (${u.role})` : sh(hash);
}
const pill = (t, c) => `<span class="pill ${c}">${t}</span>`, msg = e => (e.reason || e.shortMessage || e.message || 'Failed').toString().slice(0, 160);

const opts = (a, v) => a.map(x => `<option ${x == v ? 'selected' : ''}>${x}</option>`).join('');

const stat = b => b.rec ? pill('Recalled','bad') : b.flag ? pill('Flagged','warn') : pill('OK','ok');

function toast(m) { $('#toast').innerHTML = `<div class="toast">${m}</div>`; setTimeout(() => $('#toast').innerHTML = '', 3500); }



// ---------- login ----------

function loginView() {
  $('#root').innerHTML = `
    <div class="login">
      <div class="hero">
        <b style="font-size:1.2rem">Farm2Fork</b>
        <div>
          <h1>Know your food from the field.</h1>
          <p style="margin:16px 0 22px">
            Ethereum smart-contract traceability, ML adulteration-risk
            scoring and QR verification for every batch.
          </p>
          <div class="path">
            <span>🌱 Farmer</span><i>→</i>
            <span>🏭 Processor</span><i>→</i>
            <span>🚚 Distributor</span><i>→</i>
            <span>🏪 Retailer</span><i>→</i>
            <span>📱 Consumer</span>
          </div>
        </div>
        <span></span>
      </div>

      <div class="lf">
        <form onsubmit="event.preventDefault(); emailLogin();">
          <h2>Sign in</h2>

          <label>
            Email address
            <input id="loginEmail" type="email" placeholder="Enter your email" required>
          </label>

          <label>
            Password
            <input id="loginPassword" type="password" placeholder="Enter your password" required>
          </label>

          <button type="submit">Sign in</button>

          <div class="sub" style="margin:0;text-align:center">
            New to Farm2Fork?
          </div>

          <button type="button" class="g" onclick="registerView()">
            Create account
          </button>

          <div class="err" id="err"></div>
        </form>
      </div>
    </div>
  `;
}

// ---------- registration ----------

function registerView() {
  $('#root').innerHTML = `
    <div class="login">
      <div class="hero">
        <b style="font-size:1.2rem">Farm2Fork</b>
        <div>
          <h1>Create your account.</h1>
          <p style="margin:16px 0 22px">
            Join the Farm2Fork food traceability platform.
          </p>
        </div>
        <span></span>
      </div>

      <div class="lf">
        <form onsubmit="event.preventDefault(); registerUser();">
          <h2>Create account</h2>

          <label>
            Full name
            <input id="registerName" type="text" placeholder="Enter your name" required>
          </label>

          <label>
            Email address
            <input id="registerEmail" type="email" placeholder="Enter your email" required>
          </label>

          <label>
            Password
            <input id="registerPassword" type="password" placeholder="Minimum 6 characters" minlength="6" required>
          </label>

          <label>
            Select role
            <select id="registerRole" required>
              <option value="Farmer">Farmer</option>
              <option value="Processor">Processor</option>
              <option value="Distributor">Distributor</option>
              <option value="Retailer">Retailer</option>
              <option value="Consumer" selected>Consumer</option>
            </select>
          </label>

          <button type="submit">Create account</button>

          <div class="sub" style="margin:0;text-align:center">
            Already have an account?
          </div>

          <button type="button" class="g" onclick="loginView()">Back to Sign in</button>
          <div class="err" id="err"></div>
        </form>
      </div>
    </div>
  `;
}

// ---------- authentication ----------

const loginErr = e => {
  const x = $('#err');
  if (x) x.textContent = msg(e);
};

async function registerUser() {
  try {
    const name = $('#registerName').value.trim();
    const email = $('#registerEmail').value.trim().toLowerCase();
    const password = $('#registerPassword').value;
    const role = $('#registerRole').value;

    if (!name || !email || !password || !role) {
      throw Error('Please fill in all fields');
    }

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });

    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Registration failed');

    alert(`Account created successfully as ${role}. Please sign in.`);
    loginView();
  } catch (e) {
    loginErr(e);
  }
}

async function emailLogin() {
  try {
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    if (!email || !password) throw Error('Please enter email and password');

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Login failed');

    sessionStorage.setItem('farm2fork_token', data.token);
    sessionStorage.setItem('farm2fork_user', JSON.stringify(data.user));
    await enterAuthenticatedUser(data.user);
  } catch (e) {
    loginErr(e);
  }
}

async function enterAuthenticatedUser(user) {
  try {
    if (!CFG) throw Error('Contract configuration not found');
    me = ethers.id(String(user.id));
    role = user.role || 'Consumer';
    mod = vid ? 'verify' : (ACC[role] || ACC.Consumer)[0];
    render();
  } catch (e) {
    loginErr(e);
  }
}

async function restoreSession() {
  const token = sessionStorage.getItem('farm2fork_token');
  if (!token) {
    loginView();
    return;
  }

  try {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Session expired');
    sessionStorage.setItem('farm2fork_user', JSON.stringify(data.user));
    await enterAuthenticatedUser(data.user);
  } catch (e) {
    sessionStorage.removeItem('farm2fork_token');
    sessionStorage.removeItem('farm2fork_user');
    loginView();
  }
}

function logout() {
  sessionStorage.removeItem('farm2fork_token');
  sessionStorage.removeItem('farm2fork_user');
  me = null;
  role = null;
  mod = null;
  C = null;
  if (CFG) initReadOnlyBlockchain();
  loginView();
}

// ---------- chain helpers ----------


const bt = r => ({ id:Number(r.id), com:r.commodity, prod:r.product, qty:Number(r.quantity), origin:r.origin, owner:r.owner, stage:Number(r.stage), isP:r.isProduct, used:r.consumed, par:r.parents.map(Number), lab:Number(r.labScore), cid:r.reportCid, risk:Number(r.risk), flag:r.flagged, rec:r.recalled, why:r.recallReason });

const sp = s => ({ stage:Number(s.stage), by:s.by, to:s.to, temp:Number(s.tempDev), hrs:Number(s.hrs), note:s.note, ts:Number(s.ts) });

async function all() { const n = Number(await C.count()); return (await Promise.all(Array.from({ length: n }, (_, i) => C.getBatch(i + 1)))).map(bt); }

function initReadOnlyBlockchain() {
  try {
    if (!CFG) throw Error('Blockchain configuration not found');
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    C = new ethers.Contract(CFG.address, CFG.abi, provider);
    return true;
  } catch (e) {
    console.error('Read-only blockchain connection failed:', e);
    return false;
  }
}

// ML features for a batch (includes its ancestors): stage durations, max temp deviation, lowest lab score, mean handler reputation

async function feats(b, A) {

  const ids = new Set, q = [b.id]; while (q.length) { const i = q.pop(); if (!ids.has(i)) { ids.add(i); A[i - 1].par.forEach(p => q.push(p)); } }

  const S = (await Promise.all([...ids].map(i => C.getSteps(i)))).flat().map(sp), d = [0, 0, 0, 0];

  S.forEach(s => { if (s.stage < 4) d[s.stage] = Math.max(d[s.stage], s.hrs); });

  const hs = [...new Set(S.map(s => s.by))], rp = hs.length ? (await Promise.all(hs.map(a => C.reputation(a)))).map(Number) : [80];

  return { commodity: b.com, dur_farm: d[0], dur_processing: d[1], dur_distribution: d[2], dur_retail: d[3], temp_dev_max: Math.max(0, ...S.map(s => Math.abs(s.temp))), lab_score: Math.min(...[...ids].map(i => A[i - 1].lab)), handler_reputation: rp.reduce((a, x) => a + x, 0) / rp.length };

}

async function mlRisk(rows) {

  const r = await fetch('/api/risk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });

  if (!r.ok) throw Error('ML service offline — start it with: python ml/app.py'); return r.json();

}

const anom = x => x.anomaly ? pill('Unusual pattern', 'warn') : pill('Normal', 'ok');

const why = x => x.reasons.map(r => `${r.direction == 'raises' ? '<span style="color:var(--bad)">▲</span>' : '<span style="color:var(--ok)">▼</span>'} ${r.label}`).join('<br>');

async function handlerStats(A, R) {                  // per-handler record -> ML service -> suggested reputation

  const H = {};

  for (const b of A) {

    const bad = b.flag || b.rec || (R[b.id - 1] && R[b.id - 1].risk >= 60);

    for (const a of new Set((await C.getSteps(b.id)).map(s => s.by))) { H[a] = H[a] || { total: 0, flagged: 0 }; H[a].total++; if (bad) H[a].flagged++; }

  }

  const list = Object.entries(H).map(([address, v]) => ({ address, ...v })); if (!list.length) return [];

  const rep = await (await fetch('/api/reputation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handlers: list }) })).json();

  return Promise.all(list.map(async (h, i) => ({ ...h, now: Number(await C.reputation(h.address)), sug: rep[i].reputation, role: RN[Number(await C.roles(h.address))] })));

}

async function pin(f) {                              // upload to IPFS through the backend (Pinata)

  const data = await new Promise(r => { const x = new FileReader(); x.onload = () => r(x.result.split(',')[1]); x.readAsDataURL(f); });

  const r = await fetch('/api/ipfs/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data }) }), j = await r.json();

  if (!r.ok) throw Error(j.error); if (!j.pinned) toast('No Pinata key set — placeholder CID used'); return j.cid;

}



// ---------- modules ----------

const V = {

  async dash() {

    const A = await all(), users = await loadBlockchainUsers();

    return `<h2>Dashboard</h2><p class="sub">Live from the Ethereum contract.</p><div class="grid">${[['Batches', A.length], ['Products', A.filter(b => b.isP).length], ['Flagged', A.filter(b => b.flag).length], ['Recalled', A.filter(b => b.rec).length]].map(k => `<div class="card kpi"><span>${k[0]}</span><b>${k[1]}</b></div>`).join('')}</div>

    <div class="card tw" style="margin-top:16px"><table><tr><th>ID</th><th>Item</th><th>Qty</th><th>Stage</th><th>Holder</th><th>Status</th></tr>${A.slice().reverse().map(b => `<tr><td class="mono">#${b.id}</td><td>${CAT[b.com].i} ${b.prod}</td><td>${b.qty}</td><td>${ST[b.stage]}</td><td>${userLabel(b.owner, users)}</td><td>${stat(b)}</td></tr>`).join('') || '<tr><td colspan=6>No batches yet.</td></tr>'}</table></div>`;

  },

  reg() {

    return `<h2>Register harvest batch</h2><p class="sub">Writes the batch to the blockchain; the lab report goes to IPFS.</p><div class="card"><div class="row"><label>Commodity<select id="c">${opts(Object.keys(CAT))}</select></label><label>Quantity<input id="q" type="number" value="500"></label><label>Origin<input id="o" value="Vellore"></label><label>Lab score (0-100)<input id="l" type="number" value="90"></label></div><label style="margin:12px 0">Lab report (PDF / image)<input id="f" type="file"></label><button onclick="doReg()">Register on blockchain</button></div>`;

  },

  async proc() {

    const A = await all(), raws = A.filter(b => b.owner == me && b.stage == 1 && !b.isP && !b.used && b.com == pc);

    return `<h2>Processing</h2><p class="sub">Combine received raw batches into one product.</p><div class="card"><label>Commodity<select onchange="pc=this.value;render()">${opts(Object.keys(CAT), pc)}</select></label><h3 style="margin:14px 0 6px">Raw batches received</h3>${raws.map(b => `<label style="flex-direction:row;display:flex;gap:8px;align-items:center"><input type="checkbox" class="rw" value="${b.id}" style="width:auto"><span class="mono">#${b.id}</span> ${b.qty} ${CAT[pc].u} · ${b.origin}</label>`).join('') || '<p class="sub">None yet — a Farmer must transfer a batch to you first.</p>'}

    <div class="row" style="margin-top:12px"><label>Product<select id="pp">${CAT[pc].p.map(p => `<option>${p.n}</option>`).join('')}</select></label><label>Output quantity<input id="pq" type="number" value="100"></label><label>Lab score<input id="pl" type="number" value="88"></label></div><label style="margin:12px 0">Lab report<input id="pf" type="file"></label><button onclick="doProc()">Create product on-chain</button></div>`;

  },

  async move() {

    const users = await loadBlockchainUsers();
const A = await all(), mine = A.filter(b => b.owner == me && !b.used && !b.rec && b.stage < 4 && (b.stage == 0 || b.isP)), H = {};

    for (const s of new Set(mine.map(b => b.stage))) if (s < 3) H[s] = await C.getHolders(s + 2);

    return `<h2>Transfers</h2><p class="sub">Hand a batch to the next role. Duration and temperature deviation feed the ML model.</p><div class="card tw"><table><tr><th>ID</th><th>Item</th><th>Stage</th><th>Send to</th><th>Temp dev °C</th><th>Hours</th><th></th></tr>${mine.map(b => `<tr><td class="mono">#${b.id}</td><td>${CAT[b.com].i} ${b.prod}</td><td>${ST[b.stage]}</td><td>${b.stage < 3 ? `<select id="r${b.id}">${H[b.stage].map(a => {
  const u = users.find(x => x.blockchainId.toLowerCase() === String(a).toLowerCase());
  return u ? `<option value="${u.id}">${u.name} (${u.role})</option>` : '';
}).join('')}</select>` : '—'}</td><td><input id="t${b.id}" type="number" value="1" style="width:80px"></td><td><input id="h${b.id}" type="number" value="4" style="width:80px"></td><td><button onclick="doMove(${b.id},${b.stage})">${b.stage < 3 ? 'Transfer' : 'Mark sold'}</button></td></tr>`).join('') || '<tr><td colspan=7>Nothing waiting with you.</td></tr>'}</table></div>`;

  },

  async mon() {

    const A = await all(); const users = await loadBlockchainUsers(); let R = [], err = '', hs = [];

    try { R = await mlRisk(await Promise.all(A.map(b => feats(b, A)))); hs = await handlerStats(A, R); } catch (e) { err = e.message; }

    return `<h2>Risk & recall</h2><p class="sub">Stacked ensemble (Random Forest + XGBoost + LightGBM), probability-calibrated, with SHAP reasons and anomaly detection. Committing a score ≥ 60 flags the batch on-chain; the Regulator can recall any batch.</p>${err ? `<div class="card">${err}</div>` : ''}<div class="card tw" style="margin-top:14px"><table><tr><th>ID</th><th>Item</th><th>On-chain</th><th>RF</th><th>XGB</th><th>LGBM</th><th>Calibrated risk</th><th>Anomaly</th><th>Why (SHAP)</th><th>Status</th><th></th></tr>${A.map((b, i) => { const x = R[i]; return `<tr><td class="mono">#${b.id}</td><td>${CAT[b.com].i} ${b.prod}</td><td>${b.risk}%</td><td>${x ? x.rf + '%' : '—'}</td><td>${x ? x.xgb + '%' : '—'}</td><td>${x ? x.lgbm + '%' : '—'}</td><td>${x ? pill(x.risk + '% ' + x.level, lvl(x.risk)[1]) : '—'}</td><td>${x ? anom(x) : '—'}</td><td style="white-space:normal;min-width:190px">${x ? why(x) : '—'}</td><td>${stat(b)}</td><td>${x && !b.rec ? `<button onclick="commitRisk(${b.id},${x.risk})">Commit</button> ` : ''}${b.rec ? '' : `<button class="g" onclick="recall(${b.id})">Recall</button>`}</td></tr>`; }).join('') || '<tr><td colspan=11>No batches yet.</td></tr>'}</table></div>

    <h3 style="margin:22px 0 4px">Handler reputation (from history)</h3><p class="sub">Each handler's score is updated from how many of the batches they touched were flagged (Bayesian smoothing, so a few batches don't swing it). Reputation is an ML input, so apply updates deliberately.</p><div class="card tw"><table><tr><th>Handler</th><th>Role</th><th>Batches</th><th>Flagged</th><th>Current</th><th>Suggested</th><th></th></tr>${hs.map(h => `<tr><td>${userLabel(h.address, users)}</td><td>${h.role}</td><td>${h.total}</td><td>${h.flagged}</td><td>${h.now}</td><td>${pill(h.sug, h.sug >= 75 ? 'ok' : h.sug >= 55 ? 'warn' : 'bad')}</td><td>${h.sug != h.now ? `<button class="g" onclick="applyReputation('${(users.find(u => u.blockchainId.toLowerCase() === h.address.toLowerCase()) || {}).id || ''}',${h.sug})">Apply</button>` : ''}</td></tr>`).join('') || '<tr><td colspan=7>No handover history yet.</td></tr>'}</table></div>`;

  },

  async roles() {
    const users = await loadBlockchainUsers();
    const rows = [];
    for (const u of users) {
      const id = u.blockchainId;
      const r = Number(await C.roles(id));
      const rep = r ? Number(await C.reputation(id)) : 0;
      rows.push(`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td><td>${r ? RN[r] : 'Not assigned'}</td><td>${rep}</td></tr>`);
    }
    return `<h2>Stakeholders</h2><p class="sub">Manage application users and their blockchain roles. The backend relayer performs all blockchain writes.</p><div class="card"><div class="row"><label>User<select id="ra">${users.filter(u => u.role !== 'Consumer' || true).map(u => `<option value="${u.id}">${u.name} — ${u.role} — ${u.email}</option>`).join('')}</select></label><label>Blockchain role<select id="rr">${['Farmer','Processor','Distributor','Retailer','Consumer'].map(r => `<option value="${r}">${r}</option>`).join('')}</select></label><label>Reputation (0-100)<input id="rp" type="number" value="85" min="0" max="100"></label></div><br><button onclick="assignRoleOnChain()">Assign blockchain role</button></div><div class="card tw" style="margin-top:14px"><table><tr><th>Name</th><th>Email</th><th>Account role</th><th>Blockchain role</th><th>Reputation</th></tr>${rows.join('') || '<tr><td colspan=5>No users yet.</td></tr>'}</table></div>`;
  },

  async verify() {

    let out = ''; if (+vid > 0) { const A = await all(), b = A[vid - 1]; out = b ? await pass(b, A) : '<div class="card">No such batch.</div>'; }

    return `<h2>Verify a product</h2><p class="sub">Enter the batch ID or scan its QR code.</p><div class="row"><label>Batch ID<input id="vi" type="number" value="${vid}" onkeydown="if(event.key=='Enter')vf()"></label><button class="a" style="flex:0 0 auto" onclick="vf()">Verify</button></div><br>${out}`;

  },

};

async function pass(b, A) {

  const users = await loadBlockchainUsers();
  const S = (await C.getSteps(b.id)).map(sp); let m = null, wy = '';

  try { m = (await mlRisk([await feats(b, A)]))[0]; } catch (e) { wy = e.message; }

  const [t, k] = lvl(b.risk), tree = i => { const x = A[i - 1]; return `<li>${CAT[x.com].i} <b>${x.prod}</b> <span class="mono">#${x.id}</span><br><span class="sub">${x.origin} · lab ${x.lab}/100</span>${x.par.length ? `<ul class="t">${x.par.map(tree).join('')}</ul>` : ''}</li>`; };

  window.QT = location.origin + location.pathname + '?batch=' + b.id;

  return `${b.rec ? `<div class="card" style="border-color:var(--bad);margin-bottom:14px"><b>⚠ RECALLED</b> — ${b.why}</div>` : ''}<div class="card pass"><div><h3>${CAT[b.com].i} ${b.prod}</h3><span class="sub mono">Batch #${b.id} · ${b.qty} · ${ST[b.stage]}</span><div class="st">

  <div><span>🌱 Origin</span><b>${b.origin}</b></div><div><span>🔬 Lab score</span><b>${b.lab}/100</b></div><div><span>⛓ On-chain risk</span>${pill(b.risk + '% ' + t, k)}</div>

  <div><span>🤖 Live ML risk (stacked, calibrated)</span>${m ? pill(m.risk + '% ' + m.level, lvl(m.risk)[1]) : `<span class="sub">${wy}</span>`}</div>${m ? `<div><span>🔎 Main reasons (SHAP)</span><span style="text-align:right">${why(m)}</span></div><div><span>⚠ Anomaly check</span>${anom(m)}</div>` : ''}

  <div><span>📄 Lab report (IPFS)</span>${b.cid ? `<a class="mono" target="_blank" href="https\://gateway.pinata.cloud/ipfs/${b.cid}">${b.cid.slice(0, 14)}…</a>` : '—'}</div><div><span>👤 Current holder</span><span>${userLabel(b.owner, users)}</span></div></div></div><div id="qr"></div></div>

  <div class="card" style="margin-top:14px"><h3>Origin trace</h3><ul class="t" style="border:0;padding:0">${tree(b.id)}</ul></div>

  <div class="card" style="margin-top:14px"><h3>Journey on-chain</h3>${S.map(s => `<div class="st" style="margin:0"><div><span>${ST[s.stage]} → ${s.note == 'sold' ? 'Sold' : ST[s.stage + 1]} · ${s.hrs}h · ${s.temp}°C dev.</span><span>${new Date(s.ts * 1000).toLocaleString()} · ${userLabel(s.by, users)}</span></div></div>`).join('') || '<p class="sub">No handovers yet.</p>'}</div>`;

}


async function assignRoleOnChain() {
  try {
    const userId = $('#ra').value;
    const roleName = $('#rr').value;
    const reputationValue = Number($('#rp').value);
    if (!userId) throw Error('Select a user');
    if (!Number.isInteger(reputationValue) || reputationValue < 0 || reputationValue > 100) throw Error('Reputation must be between 0 and 100');
    const data = await api('/api/blockchain/assign-role', {
      method: 'POST',
      body: JSON.stringify({ userId, role: roleName, reputation: reputationValue })
    });
    toast(`Role assigned. Tx: ${data.transactionHash.slice(0, 12)}…`);
    await render();
  } catch (e) { toast(msg(e)); }
}
// ---------- actions ----------

async function doReg() {
  try {
    const f = $('#f').files[0];
    const cid = f ? await pin(f) : '';
    const user = JSON.parse(sessionStorage.getItem('farm2fork_user') || '{}');
    if (!user.id) throw Error('Please sign in again');
    if (user.role !== 'Farmer') throw Error('Only Farmers can register harvest batches');
    const data = await api('/api/blockchain/register-batch', {
      method: 'POST', body: JSON.stringify({ userId: user.id, commodity: $('#c').value, quantity: +$('#q').value, origin: $('#o').value, labScore: +$('#l').value, reportCid: cid })
    });
    toast(`Batch registered on blockchain. Tx: ${data.transactionHash.slice(0, 12)}…`);
    mod = 'move'; await render();
  } catch (e) { toast(msg(e)); }
}

async function doProc() {
  const ids = [...document.querySelectorAll('.rw:checked')].map(x => +x.value);
  if (!ids.length) return toast('Select at least one raw batch');
  try {
    const f = $('#pf').files[0];
    const cid = f ? await pin(f) : '';
    const data = await api('/api/blockchain/process-batch', {
      method: 'POST', body: JSON.stringify({ batchIds: ids, product: $('#pp').value, quantity: +$('#pq').value, labScore: +$('#pl').value, reportCid: cid })
    });
    toast(`Product created on blockchain. Tx: ${data.transactionHash.slice(0, 12)}…`);
    mod = 'move'; await render();
  } catch (e) { toast(msg(e)); }
}

async function doMove(id, s) {
  try {
    const temp = +$('#t' + id).value, hrs = +$('#h' + id).value;
    if (s < 3) {
      const toUserId = $('#r' + id).value;
      if (!toUserId) return toast('No eligible stakeholder is registered');
      const data = await api('/api/blockchain/transfer-batch', {
        method: 'POST', body: JSON.stringify({ batchId: id, toUserId, tempDev: temp, hrs, note: '' })
      });
      toast(`Batch transferred. Tx: ${data.transactionHash.slice(0, 12)}…`);
    } else {
      const data = await api('/api/blockchain/sell-batch', {
        method: 'POST', body: JSON.stringify({ batchId: id, tempDev: temp, hrs })
      });
      toast(`Batch marked sold. Tx: ${data.transactionHash.slice(0, 12)}…`);
    }
    await render();
  } catch (e) { toast(msg(e)); }
}

async function commitRisk(id, score) {
  try {
    const data = await api('/api/blockchain/risk', { method: 'POST', body: JSON.stringify({ batchId: id, score }) });
    toast(`Risk committed. Tx: ${data.transactionHash.slice(0, 12)}…`); await render();
  } catch (e) { toast(msg(e)); }
}

async function recall(id) {
  const reason = prompt('Reason for recall?');
  if (!reason) return;
  try {
    const data = await api('/api/blockchain/recall', { method: 'POST', body: JSON.stringify({ batchId: id, reason }) });
    toast(`Batch recalled. Tx: ${data.transactionHash.slice(0, 12)}…`); await render();
  } catch (e) { toast(msg(e)); }
}

async function applyReputation(userId, reputation) {
  try {
    const data = await api('/api/blockchain/reputation', { method: 'POST', body: JSON.stringify({ userId, reputation }) });
    toast(`Reputation updated. Tx: ${data.transactionHash.slice(0, 12)}…`); await render();
  } catch (e) { toast(msg(e)); }
}

function vf() { vid = $('#vi').value; render(); }



// ---------- shell ----------

async function render() {

  if (!ACC[role].includes(mod)) mod = ACC[role][0];

  $('#root').innerHTML = `<div class="app"><nav><b>🌾 Farm2Fork</b>${ACC[role].map(m => `<a class="${m == mod ? 'on' : ''}" onclick="mod='${m}';render()"><span>${MOD[m][1]}</span>${MOD[m][0]}</a>`).join('')}<div class="me">${role}<br><span class="mono">${sh(me)}</span><br><a style="padding:6px 0" onclick="logout()">Sign out</a></div></nav><main id="main">Loading…</main></div>`;

  try { $('#main').innerHTML = await V[mod](); } catch (e) { $('#main').innerHTML = `<div class="card">${msg(e)}</div>`; }

  if (mod == 'verify' && $('#qr') && window.QT) try { new QRCode($('#qr'), { text: window.QT, width: 120, height: 120 }); } catch (e) {}

}

(async () => { try { CFG = await (await fetch('js/contract.json')).json(); } catch (e) { CFG = null; } if (CFG) initReadOnlyBlockchain(); await restoreSession(); })();
