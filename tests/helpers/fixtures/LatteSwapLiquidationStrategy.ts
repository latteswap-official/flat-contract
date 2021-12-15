import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
import { ethers, upgrades } from "hardhat";
import {
  Clerk__factory,
  Clerk,
  SimpleToken,
  SimpleToken__factory,
  LatteSwapLiquidationStrategy__factory,
  LatteSwapLiquidationStrategy,
  MockFlatMarketForLatteSwapLiquidationStrategy,
  CompositeOracle__factory,
  FlatMarketConfig__factory,
  MockFlatMarketForLatteSwapLiquidationStrategy__factory,
} from "../../../typechain/v8";
import { BaseContract, BigNumber, constants, Wallet } from "ethers";
import { MockProvider } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MockWBNB__factory } from "@latteswap/latteswap-contract/compiled-typechain";
import {
  LatteSwapFactory,
  LatteSwapFactory__factory,
  LatteSwapPair,
  LatteSwapPair__factory,
  LatteSwapRouter,
  LatteSwapRouter__factory,
} from "../../../typechain/v6";

export interface ILatteSwapLiquidationStrategyDTO {
  latteSwapLiquidationStrategy: LatteSwapLiquidationStrategy;
  clerk: Clerk;
  router: LatteSwapRouter;
  factory: LatteSwapFactory;
  token0: SimpleToken;
  token1: SimpleToken;
  flat: SimpleToken;
  lp: LatteSwapPair;
  deployer: SignerWithAddress;
  reserve0: BigNumber;
  reserve1: BigNumber;
  reserveFlat: BigNumber;
  flatMarket: MockFlatMarketForLatteSwapLiquidationStrategy;
  flatMarketConfig: FakeContract<BaseContract>;
  compositeOracle: FakeContract<BaseContract>;
}

export async function latteSwapLiquidationStrategyIntegrationTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<ILatteSwapLiquidationStrategyDTO> {
  const FOREVER = "2000000000";
  const [deployer] = await ethers.getSigners();
  const reserve0 = ethers.utils.parseEther("100000");
  const reserve1 = ethers.utils.parseEther("10000");
  const reserveFlat = ethers.utils.parseEther("168168");

  const MockWBNB = new MockWBNB__factory(deployer);
  const wbnb = await MockWBNB.deploy();
  await wbnb.deployed();

  // Deploy Clerk
  const Clerk = new Clerk__factory(deployer);
  const clerk: Clerk = (await upgrades.deployProxy(Clerk, [wbnb.address])) as Clerk;

  // Deploy mocked stake tokens
  const stakingTokens = [];
  for (let i = 0; i < 4; i++) {
    const SimpleToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
    const simpleToken = (await SimpleToken.deploy()) as SimpleToken;
    await simpleToken.deployed();
    await simpleToken.mint(deployer.address, ethers.utils.parseEther("1000000000"));
    stakingTokens.push(simpleToken);
  }

  const [token0, token1, flat] = [stakingTokens[0], stakingTokens[1], stakingTokens[2]];

  const Factory = new LatteSwapFactory__factory(deployer);
  const factory = await Factory.deploy(deployer.address);
  await factory.deployed();
  await factory.createPair(token0.address, token1.address);

  const Router = new LatteSwapRouter__factory(deployer);
  const router = await Router.deploy(factory.address, wbnb.address);

  await token0.approve(router.address, constants.MaxUint256);
  await token1.approve(router.address, constants.MaxUint256);
  await flat.approve(router.address, constants.MaxUint256);

  await router.deployed();
  // add liquidity for token0-token1
  await router.addLiquidity(
    token0.address,
    token1.address,
    reserve0,
    reserve1,
    "0",
    "0",
    await deployer.getAddress(),
    FOREVER
  );
  // add liquidity for token0-flat
  await router.addLiquidity(
    token0.address,
    flat.address,
    reserve0,
    reserveFlat,
    "0",
    "0",
    await deployer.getAddress(),
    FOREVER
  );
  // add liquidity for token1-flat
  await router.addLiquidity(
    token1.address,
    flat.address,
    reserve1,
    reserveFlat,
    "0",
    "0",
    await deployer.getAddress(),
    FOREVER
  );

  // token0-token1 lp
  const lp = LatteSwapPair__factory.connect(
    await factory.getPair(token0.address, token1.address),
    deployer
  ) as LatteSwapPair;

  // Deploy FlatMarketConfig
  const flatMarketConfigFactory = (await ethers.getContractFactory(
    "FlatMarketConfig",
    deployer
  )) as FlatMarketConfig__factory;
  const mockedFlatMarketConfig = await smock.fake(flatMarketConfigFactory);

  // Deploy mocked composite oracle
  const CompositeOracle = (await ethers.getContractFactory("CompositeOracle", deployer)) as CompositeOracle__factory;
  const mockedCompositeOracle = await smock.fake(CompositeOracle);

  // Deploy FlatMarket
  const FlatMarket = (await ethers.getContractFactory(
    "MockFlatMarketForLatteSwapLiquidationStrategy",
    deployer
  )) as MockFlatMarketForLatteSwapLiquidationStrategy__factory;
  const flatMarket = await FlatMarket.deploy();
  await flatMarket.initialize(
    clerk.address,
    flat.address,
    lp.address,
    mockedFlatMarketConfig.address,
    mockedCompositeOracle.address,
    ethers.utils.defaultAbiCoder.encode(["address"], [constants.AddressZero])
  );

  const LatteSwapLiquidationStrategy = (await ethers.getContractFactory(
    "LatteSwapLiquidationStrategy",
    deployer
  )) as LatteSwapLiquidationStrategy__factory;
  const latteSwapLiquidationStrategy = (await upgrades.deployProxy(LatteSwapLiquidationStrategy, [
    clerk.address,
    router.address,
  ])) as LatteSwapLiquidationStrategy;
  await latteSwapLiquidationStrategy.deployed();

  return {
    latteSwapLiquidationStrategy,
    clerk,
    router,
    factory,
    token0,
    token1,
    flat,
    lp,
    deployer,
    reserve0,
    reserve1,
    reserveFlat,
    flatMarket,
    flatMarketConfig: mockedFlatMarketConfig,
    compositeOracle: mockedCompositeOracle,
  };
}
