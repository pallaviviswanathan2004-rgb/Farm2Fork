require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const cors = require('cors');
const { ethers } = require('ethers');
const User = require('./models/User');

const authRoutes = require('./routes/auth');
const blockchain = require('./blockchain');

const app = express();

const PORT = process.env.PORT || 3000;
const ML_PORT = process.env.ML_PORT || 5001;
const PINATA_JWT = process.env.PINATA_JWT;

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');

// ---------------- MIDDLEWARE ----------------

app.use(cors());

app.use(express.json({
  limit: '15mb'
}));

app.get('/api/health', async (req, res) => {
  let blockchainOk = false;
  try { await blockchain.provider.getBlockNumber(); blockchainOk = true; } catch (_) {}
  res.json({ ok: true, service: 'Farm2Fork', mongodb: mongoose.connection.readyState === 1, blockchain: blockchainOk, contract: blockchain.contractConfig.address });
});

// ---------------- DATABASE ----------------

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
  });

// ---------------- AUTH ----------------

app.use('/api/auth', authRoutes);

function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
    const jwt = require('jsonwebtoken');
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'You are not authorised for this action' });
}

const ROLE_MAP = { Farmer: 1, Processor: 2, Distributor: 3, Retailer: 4, Consumer: 5 };
const hashUser = id => ethers.id(String(id));

async function getUserOrFail(id) {
  if (!id) throw new Error('User ID is required');
  const user = await User.findById(id).select('name email role');
  if (!user) throw new Error('User not found');
  return user;
}

async function waitTx(tx) {
  const receipt = await tx.wait();
  return receipt.hash;
}
app.get('/api/blockchain/public-users', async (req, res) => {
  try {
    const users = await User.find(
      { role: { $in: Object.keys(ROLE_MAP) } },
      { name: 1, role: 1 }
    ).sort({ role: 1, name: 1 }).lean();
    res.json({ users: users.map(u => ({ id: String(u._id), name: u.name, role: u.role, blockchainId: hashUser(u._id) })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/blockchain/users', requireAuth, async (req, res) => {
  try {
    const users = await User.find(
      { role: { $in: Object.keys(ROLE_MAP) } },
      { name: 1, email: 1, role: 1 }
    ).sort({ role: 1, name: 1 }).lean();

    res.json({ users: users.map(u => ({
      id: String(u._id), name: u.name, email: u.email, role: u.role,
      blockchainId: hashUser(u._id)
    })) });
  } catch (e) {
    console.error('Blockchain users error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/blockchain/assign-role', requireAuth, requireRole('Regulator'), async (req, res) => {
  try {
    const { userId, role, reputation = 85 } = req.body;
    if (!userId || !ROLE_MAP[role]) return res.status(400).json({ error: 'Valid userId and application role are required' });
    const rep = Number(reputation);
    if (!Number.isInteger(rep) || rep < 0 || rep > 100) return res.status(400).json({ error: 'Reputation must be between 0 and 100' });
    const user = await getUserOrFail(userId);
    if (user.role !== role) return res.status(400).json({ error: `MongoDB role is ${user.role}; update the account role first` });
    const blockchainUserId = hashUser(user._id);
    const existing = Number(await blockchain.contract.roles(blockchainUserId));
    if (existing !== 0) return res.status(409).json({ error: 'This user already has a blockchain role' });
    const tx = await blockchain.contract.assignRole(blockchainUserId, ROLE_MAP[role], rep);
    const transactionHash = await waitTx(tx);
    res.json({ message: 'User role assigned on blockchain', userId, role, transactionHash });
  } catch (e) {
    console.error('Assign role blockchain error:', e);
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/register-batch', requireAuth, requireRole('Farmer'), async (req, res) => {
  try {
    const { commodity, quantity, origin, labScore, reportCid } = req.body;
    const qty = Number(quantity), score = Number(labScore || 0);
    if (!commodity || !Number.isFinite(qty) || qty <= 0 || !origin) return res.status(400).json({ error: 'Commodity, positive quantity and origin are required' });
    if (!Number.isInteger(score) || score < 0 || score > 100) return res.status(400).json({ error: 'Lab score must be between 0 and 100' });
    const blockchainUserId = hashUser(req.user.id);
    const role = Number(await blockchain.contract.roles(blockchainUserId));
    if (role !== ROLE_MAP.Farmer) return res.status(403).json({ error: 'Your blockchain Farmer role is not assigned yet' });
    const tx = await blockchain.contract.registerBatchByRelayer(blockchainUserId, commodity, qty, origin, score, reportCid || '');
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Batch registered on blockchain', transactionHash });
  } catch (e) {
    console.error('Register batch blockchain error:', e);
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/process-batch', requireAuth, requireRole('Processor'), async (req, res) => {
  try {
    const { batchIds, product, quantity, labScore, reportCid } = req.body;
    const ids = Array.isArray(batchIds) ? batchIds.map(Number).filter(Number.isInteger) : [];
    const qty = Number(quantity), score = Number(labScore || 0);
    if (!ids.length || !product || !Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Select at least one batch and provide a positive output quantity' });
    if (score < 0 || score > 100) return res.status(400).json({ error: 'Lab score must be between 0 and 100' });
    const processor = hashUser(req.user.id);
    if (Number(await blockchain.contract.roles(processor)) !== ROLE_MAP.Processor) return res.status(403).json({ error: 'Your blockchain Processor role is not assigned yet' });
    const tx = await blockchain.contract.processBatchByRelayer(processor, ids, product, qty, score, reportCid || '');
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Product created on blockchain', transactionHash });
  } catch (e) {
    console.error('Process batch blockchain error:', e);
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/transfer-batch', requireAuth, requireRole('Farmer', 'Processor', 'Distributor'), async (req, res) => {
  try {
    const { batchId, toUserId, tempDev = 0, hrs = 0, note = '' } = req.body;
    const id = Number(batchId), temp = Number(tempDev), hours = Number(hrs);
    if (!Number.isInteger(id) || id <= 0 || !toUserId) return res.status(400).json({ error: 'Valid batchId and destination user are required' });
    if (!Number.isFinite(temp) || !Number.isInteger(hours) || hours < 0) return res.status(400).json({ error: 'Invalid temperature deviation or hours' });
    const recipient = await getUserOrFail(toUserId);
    const senderHash = hashUser(req.user.id), recipientHash = hashUser(recipient._id);
    const expectedRecipient = { Farmer: 'Processor', Processor: 'Distributor', Distributor: 'Retailer' }[req.user.role];
    if (recipient.role !== expectedRecipient) return res.status(400).json({ error: `Batch must be sent to a ${expectedRecipient}` });
    if (Number(await blockchain.contract.roles(senderHash)) !== ROLE_MAP[req.user.role]) return res.status(403).json({ error: 'Your blockchain role is not assigned yet' });
    if (Number(await blockchain.contract.roles(recipientHash)) !== ROLE_MAP[recipient.role]) return res.status(400).json({ error: 'Destination user has no blockchain role yet' });
    const tx = await blockchain.contract.transferByRelayer(senderHash, id, recipientHash, Math.round(temp), hours, String(note || ''));
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Batch transferred on blockchain', transactionHash });
  } catch (e) {
    console.error('Transfer batch blockchain error:', e);
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/sell-batch', requireAuth, requireRole('Retailer'), async (req, res) => {
  try {
    const { batchId, tempDev = 0, hrs = 0 } = req.body;
    const id = Number(batchId), temp = Number(tempDev), hours = Number(hrs);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Valid batchId is required' });
    const retailer = hashUser(req.user.id);
    if (Number(await blockchain.contract.roles(retailer)) !== ROLE_MAP.Retailer) return res.status(403).json({ error: 'Your blockchain Retailer role is not assigned yet' });
    const tx = await blockchain.contract.sellByRelayer(retailer, id, Math.round(temp), hours);
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Batch marked as sold', transactionHash });
  } catch (e) {
    console.error('Sell batch blockchain error:', e);
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/risk', requireAuth, requireRole('Regulator'), async (req, res) => {
  try {
    const id = Number(req.body.batchId), score = Number(req.body.score);
    if (!Number.isInteger(id) || score < 0 || score > 100) return res.status(400).json({ error: 'Valid batchId and 0-100 score are required' });
    const tx = await blockchain.contract.setRisk(id, score);
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Risk committed on blockchain', transactionHash });
  } catch (e) {
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/recall', requireAuth, requireRole('Regulator'), async (req, res) => {
  try {
    const id = Number(req.body.batchId), reason = String(req.body.reason || '').trim();
    if (!Number.isInteger(id) || !reason) return res.status(400).json({ error: 'Batch ID and recall reason are required' });
    const tx = await blockchain.contract.recall(id, reason);
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Batch recalled on blockchain', transactionHash });
  } catch (e) {
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

app.post('/api/blockchain/reputation', requireAuth, requireRole('Regulator'), async (req, res) => {
  try {
    const { userId, reputation } = req.body;
    const rep = Number(reputation);
    if (!userId || !Number.isInteger(rep) || rep < 0 || rep > 100) return res.status(400).json({ error: 'Valid userId and reputation 0-100 are required' });
    const user = await getUserOrFail(userId);
    const tx = await blockchain.contract.setReputation(hashUser(user._id), rep);
    const transactionHash = await waitTx(tx);
    res.json({ message: 'Reputation updated', transactionHash });
  } catch (e) {
    res.status(500).json({ error: e.reason || e.shortMessage || e.message });
  }
});

// ---------------- ML RISK ----------------

app.post('/api/risk', async (req, res) => {
  try {
    const response = await fetch(
      `http://127.0.0.1:${ML_PORT}/predict`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      }
    );

    const data = await response.text();

    res.status(response.status).send(data);

  } catch (error) {
    res.status(503).json({
      error: 'ML service offline'
    });
  }
});

// ---------------- ML REPUTATION ----------------

app.post('/api/reputation', async (req, res) => {
  try {
    const response = await fetch(
      `http://127.0.0.1:${ML_PORT}/reputation`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      }
    );

    const data = await response.text();

    res.status(response.status).send(data);

  } catch (error) {
    res.status(503).json({
      error: 'ML service offline'
    });
  }
});

// ---------------- IPFS / PINATA ----------------

app.post('/api/ipfs/upload', async (req, res) => {
  try {
    const { name, data } = req.body;

    if (!name || !data) {
      return res.status(400).json({
        error: 'name and data are required'
      });
    }

    // If Pinata is not configured,
    // generate a deterministic demo CID.
    if (!PINATA_JWT) {
      const cid =
        'Qm' +
        crypto
          .createHash('sha256')
          .update(data)
          .digest('hex')
          .slice(0, 44);

      return res.json({
        cid,
        pinned: false
      });
    }

    const formData = new FormData();

    formData.append(
      'file',
      new Blob([
        Buffer.from(data, 'base64')
      ]),
      name
    );

    const response = await fetch(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + PINATA_JWT
        },
        body: formData
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error:
          (result.error && result.error.details) ||
          result.error ||
          'Pinata error'
      });
    }

    res.json({
      cid: result.IpfsHash,
      pinned: true
    });

  } catch (error) {
    console.error('IPFS upload error:', error);

    res.status(500).json({
      error: error.message
    });
  }
});

// ---------------- FRONTEND ----------------

app.use(express.static(FRONTEND));

// ---------------- SPA FALLBACK ----------------

app.get('/{*splat}', (req, res) => {
  res.sendFile(
    path.join(FRONTEND, 'index.html')
  );
});

// ---------------- START SERVER ----------------

app.listen(PORT, () => {
  console.log(
    `Farm2Fork backend running at http://localhost:${PORT}`
  );
});