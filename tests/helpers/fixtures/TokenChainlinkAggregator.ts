import { MockProvider } from "ethereum-waffle";
import { BigNumber, Signer, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  TokenChainlinkAggregator,
  MockChainlinkAggregator__factory,
  MockChainlinkAggregator,
  TokenChainlinkAggregator__factory,
  SimpleToken,
  SimpleToken__factory,
} from "../../../typechain/v8";
import { smockit, MockContract } from "@eth-optimism/smock";

export interface ITokenChainlinkAggregatorDTO {
  simpleToken: SimpleToken;
  wbnb: SimpleToken;
  mockRefBNBBUSD: MockContract;
  mockRefTOKENBNB: MockContract;
  mockRefTOKENUSD: MockContract;
  tokenChainlinkAggregator: TokenChainlinkAggregator;
}

export async function tokenChainlinkAggregatorUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<any> {
  const [deployer, bob, alice, dev] = await ethers.getSigners();

  // Deploy Mock WBNB
  const WBNB = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const wbnb = (await WBNB.deploy()) as SimpleToken;
  await wbnb.deployed();

  const SimpleToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const simpleToken = (await SimpleToken.deploy()) as SimpleToken;
  await simpleToken.deployed();

  const MockChainlinkAggregator = (await ethers.getContractFactory(
    "MockChainlinkAggregator",
    deployer
  )) as MockChainlinkAggregator__factory;
  const refBNBUSD = await MockChainlinkAggregator.deploy();
  await refBNBUSD.deployed();
  const refSimpleTokenBNB = await MockChainlinkAggregator.deploy();
  await refSimpleTokenBNB.deployed();
  const refSimpleTokenBUSD = await MockChainlinkAggregator.deploy();
  await refSimpleTokenBUSD.deployed();

  // Deploy TokenChainlinkAggregator
  const TokenChainlinkAggregator = (await ethers.getContractFactory(
    "TokenChainlinkAggregator",
    deployer
  )) as TokenChainlinkAggregator__factory;
  const mockRefBNBBUSD = await smockit(refBNBUSD);
  const mockRefTOKENBNB = await smockit(refSimpleTokenBNB);
  const mockRefTOKENUSD = await smockit(refSimpleTokenBUSD);
  const tokenChainlinkAggregator = (await upgrades.deployProxy(TokenChainlinkAggregator, [
    wbnb.address,
    mockRefBNBBUSD.address,
  ])) as TokenChainlinkAggregator;
  await tokenChainlinkAggregator.deployed();

  return {
    wbnb,
    simpleToken,
    tokenChainlinkAggregator,
    mockRefBNBBUSD,
    mockRefTOKENBNB,
    mockRefTOKENUSD,
  } as ITokenChainlinkAggregatorDTO;
}
