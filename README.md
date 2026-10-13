# Farm2Fork — Blockchain + ML Food Supply Chain

Farm2Fork is an end-to-end food traceability platform using Ethereum Sepolia, MongoDB, a backend relayer, IPFS/Pinata and a machine-learning risk service.

## Architecture

Farmer → Processor → Distributor → Retailer → Consumer verification

Normal users authenticate with email/password. They do **not** need MetaMask. Blockchain transactions are submitted by the dedicated backend relayer.

## Requirements

- Node.js 20+ (Node 24 is supported)
- Python 3.11+
- MongoDB Atlas or MongoDB
- A funded Ethereum Sepolia relayer account
- Optional Pinata JWT for real IPFS uploads

## First-time setup

1. Copy `.env.example` to `.env`.
2. Fill the existing project's real values into `.env`. Never commit `.env`.
3. Install Node dependencies:

```powershell
npm install
```

4. Install ML dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r ml\requirements.txt
```

## Run

Open two terminals.

### Terminal 1 — ML service

```powershell
python ml\app.py
```

It runs on `http://127.0.0.1:5001` by default.

### Terminal 2 — Farm2Fork web application

```powershell
npm start
```

Open:

`http://localhost:3000`

## Blockchain deployment

The supplied `frontend/js/contract.json` already contains the configured deployed contract address. You only need to deploy again if you intentionally want a fresh contract.

For a new Sepolia deployment:

```powershell
npm run compile
npm run deploy:sepolia
```

The deployer account must have enough Sepolia ETH and `RELAYER_ADDRESS` must point to the backend relayer account.

## User workflow

1. Register/login.
2. A Regulator assigns the user's application role to the blockchain.
3. Farmer registers a harvest batch and optionally uploads a lab report to IPFS.
4. Farmer transfers the batch to a Processor.
5. Processor combines received raw batches into a product.
6. Processor transfers to Distributor.
7. Distributor transfers to Retailer.
8. Retailer marks the batch sold.
9. Consumer/public users verify a batch by ID or QR code.
10. Regulator can commit ML risk scores and recall unsafe batches.

## Security

- Do not put private keys, MongoDB passwords or Pinata secrets in source control.
- Normal users never receive or enter blockchain private keys.
- The backend checks JWT authentication and application roles before blockchain writes.
- The relayer private key is server-side only.

## Notes

The project intentionally keeps blockchain records immutable. If a test batch was already written to a deployed contract, it cannot be deleted from that contract; deploy a fresh contract when a clean chain history is required.
