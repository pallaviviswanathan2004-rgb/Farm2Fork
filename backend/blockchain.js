require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const contractPath = path.join(
  __dirname,
  '..',
  'frontend',
  'js',
  'contract.json'
);

const contractConfig = JSON.parse(
  fs.readFileSync(contractPath, 'utf8')
);

const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  'https://ethereum-sepolia-rpc.publicnode.com';

const provider = new ethers.JsonRpcProvider(RPC_URL);

const wallet = new ethers.Wallet(
  process.env.RELAYER_PRIVATE_KEY,
  provider
);

const contract = new ethers.Contract(
  contractConfig.address,
  contractConfig.abi,
  wallet
);

console.log('Blockchain relayer loaded');
console.log('Relayer:', wallet.address);
console.log('Contract:', contractConfig.address);
console.log('Network:', contractConfig.chainId);

module.exports = {
  provider,
  wallet,
  contract,
  contractConfig
};