import { MockProvider } from "ethereum-waffle";
import { Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  Clerk__factory,
  SimpleToken__factory,
  Clerk,
  CompositeOracle__factory,
  CompositeOracle,
  SimpleToken,
  FlatMarket,
  FlatMarketConfig,
  FlatMarketConfig__factory,
  FlatMarket__factory,
  MockWBNB,
  MockWBNB__factory,
  FLAT__factory,
} from "../../../typechain/v8";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { smockit, MockContract } from "@eth-optimism/smock";

export type IFlatMarketUnitDTO = {
  deployer: SignerWithAddress;
  alice: SignerWithAddress;
  mockedSimpleToken: MockContract;
  mockedClerk: MockContract;
  mockedFlat: MockContract;
  mockedCompositeOracle: MockContract;
  mockedFlatMarketConfig: MockContract;
  flatMarket: FlatMarket;
};

export async function flatMarketUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<IFlatMarketUnitDTO> {
  const [deployer, alice] = await ethers.getSigners();

  // Deploy mocked WBNB
  const MockWBNB = (await ethers.getContractFactory("MockWBNB", deployer)) as MockWBNB__factory;
  const wbnb = await MockWBNB.deploy();
  await wbnb.deployed();
  const mockedWBNB = await smockit(wbnb);

  // Deploy mocked token
  const SimpleToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const simpleToken = (await SimpleToken.deploy()) as SimpleToken;
  await simpleToken.deployed();
  const mockedSimpleToken = await smockit(simpleToken);

  // Deploy mocked Clerk
  const Clerk = (await ethers.getContractFactory("Clerk", deployer)) as Clerk__factory;
  const clerk = await upgrades.deployProxy(Clerk, [mockedWBNB.address]);
  await clerk.deployed();
  const mockedClerk = await smockit(clerk);

  // Deploy FLAT
  const FLAT = (await ethers.getContractFactory("FLAT", deployer)) as FLAT__factory;
  const flat = await FLAT.deploy(24 * 60 * 60, 1500);
  await flat.deployed();
  const mockedFlat = await smockit(flat);

  // Deploy FlatMarketConfig
  const FlatMarketConfig = (await ethers.getContractFactory("FlatMarketConfig", deployer)) as FlatMarketConfig__factory;
  const flatMarketConfig = await upgrades.deployProxy(FlatMarketConfig, [deployer.address]);
  await flatMarketConfig.deployed();
  const mockedFlatMarketConfig = await smockit(flatMarketConfig);

  // Deploy mocked composit oracle
  const CompositeOracle = (await ethers.getContractFactory("CompositeOracle", deployer)) as CompositeOracle__factory;
  const compositeOracle = await upgrades.deployProxy(CompositeOracle, []);
  await compositeOracle.deployed();
  const mockedCompositeOracle = await smockit(compositeOracle);

  // Deploy FlatMarket
  const FlatMarket = (await ethers.getContractFactory("FlatMarket", deployer)) as FlatMarket__factory;
  const flatMarket = await upgrades.deployProxy(FlatMarket, [
    mockedClerk.address,
    mockedFlat.address,
    mockedSimpleToken.address,
    mockedFlatMarketConfig.address,
    mockedCompositeOracle.address,
    ethers.utils.defaultAbiCoder.encode(["address"], [mockedSimpleToken.address]),
  ]);
  await flatMarket.deployed();

  return {
    deployer,
    alice,
    mockedSimpleToken,
    mockedClerk,
    mockedFlat,
    mockedCompositeOracle,
    mockedFlatMarketConfig,
    flatMarket,
  } as IFlatMarketUnitDTO;
}
