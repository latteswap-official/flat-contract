import { MockProvider } from "ethereum-waffle";
import { Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  Clerk__factory,
  SimpleToken__factory,
  Clerk,
  SimpleToken,
  LatteSwapYieldStrategy__factory,
  LatteSwapYieldStrategy,
  MockBoosterForLatteSwapYield,
  MockBoosterForLatteSwapYield__factory,
  MockMasterBaristaForLatteSwapYield,
  MockMasterBaristaForLatteSwapYield__factory,
  NonNativeReceivableToken,
} from "../../../typechain/v8";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MockContract, smock } from "@defi-wonderland/smock";
import { LATTE, LATTE__factory, MockWBNB, MockWBNB__factory } from "@latteswap/latteswap-contract/compiled-typechain";
import { NonNativeReceivableToken__factory } from "../../../typechain/v8/factories/NonNativeReceivableToken__factory";

export type IClerkUnitDTO = {
  deployer: SignerWithAddress;
  alice: Wallet;
  bob: Wallet;
  funder: SignerWithAddress;
  wbnb: MockWBNB;
  clerk: MockContract<Clerk>;
  stakingTokens: Array<SimpleToken>;
  nonNativeReceivableToken: NonNativeReceivableToken;
};

export type IClerkIntegrationDTO = {
  deployer: SignerWithAddress;
  alice: Wallet;
  bob: Wallet;
  funder: SignerWithAddress;
  wbnb: MockWBNB;
  clerk: MockContract<Clerk>;
  stakingToken: SimpleToken;
  latteSwapPoolStrategy: LatteSwapYieldStrategy;
  booster: MockContract<MockBoosterForLatteSwapYield>;
  masterBarista: MockContract<MockMasterBaristaForLatteSwapYield>;
  latteToken: LATTE;
};

export async function clerkUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<IClerkUnitDTO> {
  const [deployer, _a, _b, funder] = await ethers.getSigners();
  let sendtx;
  const alice = ethers.Wallet.createRandom().connect(ethers.provider);

  sendtx = await funder.sendTransaction({
    to: alice.address,
    value: ethers.utils.parseEther("10000"),
  });
  await sendtx.wait();
  const bob = ethers.Wallet.createRandom().connect(ethers.provider);
  sendtx = await funder.sendTransaction({
    to: bob.address,
    value: ethers.utils.parseEther("10000"),
  });
  await sendtx.wait();

  const MockWBNB = new MockWBNB__factory(deployer);
  const wbnb = await MockWBNB.deploy();
  await wbnb.deployed();

  // Deploy Clerk
  const Clerk = await smock.mock<Clerk__factory>("Clerk", deployer);
  const clerk: MockContract<Clerk> = await Clerk.deploy();
  await clerk.initialize(wbnb.address);

  // Deploy mocked stake tokens
  const stakingTokens = [];
  for (let i = 0; i < 4; i++) {
    const SimpleToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
    const simpleToken = (await SimpleToken.deploy()) as SimpleToken;
    await simpleToken.deployed();
    await simpleToken.mint(deployer.address, ethers.utils.parseEther("1000000000"));
    await simpleToken.mint(alice.address, ethers.utils.parseEther("1000000000"));
    await simpleToken.mint(bob.address, ethers.utils.parseEther("1000000000"));
    await simpleToken.mint(funder.address, ethers.utils.parseEther("1000000000"));
    stakingTokens.push(simpleToken);
  }

  const nonNativeReceivableTokenFactory = new NonNativeReceivableToken__factory(deployer);
  const nonNativeReceivableToken = (await nonNativeReceivableTokenFactory.deploy()) as NonNativeReceivableToken;
  return {
    deployer,
    alice,
    bob,
    funder,
    wbnb,
    clerk,
    stakingTokens,
    nonNativeReceivableToken,
  } as IClerkUnitDTO;
}

export async function clerkIntegrationTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<IClerkIntegrationDTO> {
  const [deployer, _a, _b, funder] = await ethers.getSigners();
  let sendtx;
  const alice = ethers.Wallet.createRandom().connect(ethers.provider);
  sendtx = await funder.sendTransaction({
    to: alice.address,
    value: ethers.utils.parseEther("10000"),
  });
  await sendtx.wait();

  const bob = ethers.Wallet.createRandom().connect(ethers.provider);
  sendtx = await funder.sendTransaction({
    to: bob.address,
    value: ethers.utils.parseEther("10000"),
  });
  await sendtx.wait();

  const MockWBNB = new MockWBNB__factory(deployer);
  const wbnb = await MockWBNB.deploy();
  await wbnb.deployed();

  // Deploy Clerk
  const Clerk = await smock.mock<Clerk__factory>("Clerk", deployer);
  const clerk: MockContract<Clerk> = await Clerk.deploy();
  await clerk.initialize(wbnb.address);

  // Deploy LATTE
  const LATTE = new LATTE__factory(deployer) as LATTE__factory;
  const latteToken = await LATTE.deploy(await funder.getAddress(), 0, 1);
  await latteToken.deployed();

  // Deploy mocked MasterBarista
  const MasterBarista = await smock.mock<MockMasterBaristaForLatteSwapYield__factory>(
    "MockMasterBaristaForLatteSwapYield",
    deployer
  );
  const masterBarista: MockContract<MockMasterBaristaForLatteSwapYield> = await MasterBarista.deploy();
  await masterBarista.setActiveLatte(latteToken.address);

  // Mint LATTE for testing purpose
  await latteToken.mint(await deployer.getAddress(), ethers.utils.parseEther("888888888"));

  // Deploy mocked stake tokens
  const StakingToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const stakingToken = (await StakingToken.deploy()) as SimpleToken;
  await stakingToken.deployed();
  await stakingToken.mint(alice.address, ethers.utils.parseEther("1000000000"));

  // Deploy Booster
  const Booster = await smock.mock<MockBoosterForLatteSwapYield__factory>("MockBoosterForLatteSwapYield", deployer);
  const booster: MockContract<MockBoosterForLatteSwapYield> = await Booster.deploy(
    masterBarista.address,
    latteToken.address
  );
  await booster.deployed();

  await latteToken.mint(booster.address, ethers.utils.parseEther("888888888"));

  await latteToken.transferOwnership(masterBarista.address);

  // Deploy LatteSwapYieldStrategy
  const LatteSwapYieldStrategy = (await ethers.getContractFactory(
    "LatteSwapYieldStrategy",
    deployer
  )) as LatteSwapYieldStrategy__factory;
  const latteSwapPoolStrategy = (await upgrades.deployProxy(LatteSwapYieldStrategy, [
    booster.address,
    stakingToken.address,
  ])) as LatteSwapYieldStrategy;
  await latteSwapPoolStrategy.deployed();

  await clerk.setStrategy(stakingToken.address, latteSwapPoolStrategy.address);
  await clerk.setStrategyTargetBps(stakingToken.address, 10000);
  await latteSwapPoolStrategy.setTreasuryAccount(await deployer.getAddress());
  await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), clerk.address);

  return {
    deployer,
    alice,
    bob,
    funder,
    wbnb,
    clerk,
    stakingToken,
    latteSwapPoolStrategy,
    latteToken,
    masterBarista,
    booster,
  } as IClerkIntegrationDTO;
}
