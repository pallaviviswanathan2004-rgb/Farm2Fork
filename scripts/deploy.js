// Deploy Farm2Fork and write the deployed ABI/address to frontend/js/contract.json.
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const relayer = process.env.RELAYER_ADDRESS;
  if (!relayer) throw new Error('RELAYER_ADDRESS is required in .env');

  const factory = await ethers.getContractFactory(
    'contracts/FoodSupplyChain.sol:FoodSupplyChain'
  );
  const contract = await factory.deploy(relayer);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const network = await ethers.provider.getNetwork();
  const { abi } = await hre.artifacts.readArtifact(
    'contracts/FoodSupplyChain.sol:FoodSupplyChain'
  );

  fs.writeFileSync(
    path.join(__dirname, '../frontend/js/contract.json'),
    JSON.stringify({ address, chainId: Number(network.chainId), abi })
  );

  console.log(`FoodSupplyChain deployed to ${address}`);
  console.log(`Chain ID: ${network.chainId}`);
  console.log(`Regulator/deployer: ${deployer.address}`);
  console.log(`Relayer: ${relayer}`);
  console.log('contract.json updated. Assign application users through the Regulator dashboard.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
