import { MockProvider } from "ethereum-waffle";
import { BigNumber, Signer, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import { ModifiableContract, smoddit } from "@eth-optimism/smock";
import {
  LPChainlinkAggregator,
  MockLatteSwapPairLPChainlinkAggregator__factory,
  LPChainlinkAggregator__factory,
  MockChainlinkAggregator__factory,
} from "../../../typechain/v8";
import { smockit, MockContract } from "@eth-optimism/smock";

export interface ILPChainlinkAggregatorDTO {
  px1Aggregator: MockContract;
  px0Aggregator: MockContract;
  lattePair: MockContract;
  lpChainlinkAggregator: LPChainlinkAggregator;
}

export async function lpChainlinkAggregatorUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<any> {
  const [deployer, bob, alice, dev] = await ethers.getSigners();

  // Deploy Mock Chainlink Aggregator
  const MockChainlinkAggregator = (await ethers.getContractFactory(
    "MockChainlinkAggregator",
    deployer
  )) as MockChainlinkAggregator__factory;
  const px0Aggregator = await MockChainlinkAggregator.deploy();
  await px0Aggregator.deployed();
  const px1Aggregator = await MockChainlinkAggregator.deploy();
  await px1Aggregator.deployed();

  // Deploy Mock LatteSwap Pair
  const MockLatteSwapPair = (await ethers.getContractFactory(
    "MockLatteSwapPairLPChainlinkAggregator",
    deployer
  )) as MockLatteSwapPairLPChainlinkAggregator__factory;
  const lattePair = await MockLatteSwapPair.deploy();
  await lattePair.deployed();

  // Deploy LPChainlinkAggregator
  const LPChainlinkAggregator = (await ethers.getContractFactory(
    "LPChainlinkAggregator",
    deployer
  )) as LPChainlinkAggregator__factory;
  const mockLattePair = await smockit(lattePair);
  const mockPx0Aggregator = await smockit(px0Aggregator);
  const mockPx1Aggregator = await smockit(px1Aggregator);
  const lpChainlinkAggregator = (await upgrades.deployProxy(LPChainlinkAggregator, [
    mockLattePair.address,
    mockPx0Aggregator.address,
    mockPx1Aggregator.address,
  ])) as LPChainlinkAggregator;
  await lpChainlinkAggregator.deployed();

  return {
    px1Aggregator: mockPx1Aggregator,
    px0Aggregator: mockPx0Aggregator,
    lattePair: mockLattePair,
    lpChainlinkAggregator,
  } as ILPChainlinkAggregatorDTO;
}
