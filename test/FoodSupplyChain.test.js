const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('FoodSupplyChain - backend relayer model', () => {
  let c, deployer, relayer;
  const id = name => ethers.id(name);

  beforeEach(async () => {
    [deployer, relayer] = await ethers.getSigners();
    c = await (await ethers.getContractFactory('FoodSupplyChain')).deploy(relayer.address);
    await c.waitForDeployment();
  });

  async function setup() {
    const users = {
      farmer: id('farmer'),
      processor: id('processor'),
      distributor: id('distributor'),
      retailer: id('retailer')
    };
    await c.connect(relayer).assignRole(users.farmer, 1, 85);
    await c.connect(relayer).assignRole(users.processor, 2, 85);
    await c.connect(relayer).assignRole(users.distributor, 3, 85);
    await c.connect(relayer).assignRole(users.retailer, 4, 85);
    return users;
  }

  it('runs the full journey with lineage, risk and recall', async () => {
    const u = await setup();

    await c.connect(relayer).registerBatchByRelayer(u.farmer, 'Milk', 100, 'Vellore', 90, 'Qm1');
    await c.connect(relayer).transferByRelayer(u.farmer, 1, u.processor, 1, 2, 'chilled');
    await c.connect(relayer).processBatchByRelayer(u.processor, [1], 'Paneer', 15, 88, 'Qm2');
    await c.connect(relayer).transferByRelayer(u.processor, 2, u.distributor, 2, 6, '');
    await c.connect(relayer).transferByRelayer(u.distributor, 2, u.retailer, 3, 10, '');
    await c.connect(relayer).sellByRelayer(u.retailer, 2, 1, 5);

    const b = await c.getBatch(2);
    expect(b.stage).to.equal(4);
    expect(b.parents[0]).to.equal(1n);

    await c.connect(relayer).setRisk(2, 72);
    expect((await c.getBatch(2)).flagged).to.equal(true);

    await c.connect(relayer).recall(2, 'bad lab report');
    expect((await c.getBatch(2)).recalled).to.equal(true);
  });

  it('rejects unauthorized writes and invalid handovers', async () => {
    const [, other] = await ethers.getSigners();
    const u = await setup();

    await expect(
      c.connect(other).registerBatchByRelayer(u.farmer, 'Rice', 1, 'Vellore', 90, '')
    ).to.be.revertedWith('Only relayer');

    await c.connect(relayer).registerBatchByRelayer(u.farmer, 'Rice', 1, 'Vellore', 90, '');
    await expect(
      c.connect(relayer).transferByRelayer(u.farmer, 1, u.distributor, 0, 1, '')
    ).to.be.revertedWith('Recipient has wrong role');

    await c.connect(relayer).transferByRelayer(u.farmer, 1, u.processor, 0, 1, '');
    await expect(
      c.connect(relayer).transferByRelayer(u.processor, 1, u.distributor, 0, 1, '')
    ).to.be.revertedWith('Raw batch must be processed');
  });
});
