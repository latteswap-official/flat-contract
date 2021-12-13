import { MockProvider } from "ethereum-waffle";
import { BigNumber, Signer, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  LatteSwapYieldStrategy__factory,
  LatteSwapYieldStrategy,
  SimpleToken,
  SimpleToken__factory,
  MockMasterBaristaForLatteSwapYield,
  MockMasterBaristaForLatteSwapYield__factory,
  MockBoosterForLatteSwapYield,
  MockBoosterForLatteSwapYield__factory,
} from "../../../typechain/v8";
import {
  BeanBag,
  BeanBag__factory,
  LATTE,
  LATTE__factory,
  WNativeRelayer__factory,
  WNativeRelayer,
} from "@latteswap/latteswap-contract/compiled-typechain";
import { smock, MockContract } from "@defi-wonderland/smock";

export interface ILatteSwapYieldStrategyDTO {
  LATTE_START_BLOCK: number;
  LATTE_PER_BLOCK: BigNumber;
  stakingToken: SimpleToken;
  latteToken: LATTE;
  wbnb: SimpleToken;
  wNativeRelayer: WNativeRelayer;
  latteSwapPoolStrategy: LatteSwapYieldStrategy;
  booster: MockContract<MockBoosterForLatteSwapYield>;
  masterBarista: MockContract<MockMasterBaristaForLatteSwapYield>;
}

export async function latteSwapYieldStrategyUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<any> {
  const [deployer, bob, alice, dev] = await ethers.getSigners();
  const LATTE_START_BLOCK = 5;
  const LATTE_PER_BLOCK = ethers.utils.parseEther("10");

  // Deploy LATTE
  const LATTE = new LATTE__factory(deployer) as LATTE__factory;
  const latteToken = await LATTE.deploy(await dev.getAddress(), 0, 1);
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

  const MockWBNB = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const wbnb = await MockWBNB.deploy();
  await wbnb.deployed();

  const WNativeRelayer = new WNativeRelayer__factory(deployer) as WNativeRelayer__factory;
  const wNativeRelayer = await WNativeRelayer.deploy(wbnb.address);
  await wNativeRelayer.deployed();

  // Deploy Booster
  const Booster = await smock.mock<MockBoosterForLatteSwapYield__factory>("MockBoosterForLatteSwapYield", deployer);
  const booster = await Booster.deploy(masterBarista.address, latteToken.address);
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

  await wNativeRelayer.setCallerOk([booster.address], true);

  return {
    LATTE_PER_BLOCK,
    LATTE_START_BLOCK,
    stakingToken,
    latteToken,
    wbnb,
    wNativeRelayer,
    latteSwapPoolStrategy,
    booster,
    masterBarista: masterBarista,
  } as ILatteSwapYieldStrategyDTO;
}
