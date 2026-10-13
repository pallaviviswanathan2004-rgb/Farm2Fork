require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();
const { SEPOLIA_RPC_URL, PRIVATE_KEY } = process.env;
module.exports = {
  solidity: { version: '0.8.20', settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    localhost: { url: 'http://127.0.0.1:8545' },
    ...(SEPOLIA_RPC_URL && PRIVATE_KEY ? { sepolia: { url: SEPOLIA_RPC_URL, accounts: [PRIVATE_KEY] } } : {}),
  },
};
