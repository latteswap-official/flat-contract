import { MockContract, smock } from "@defi-wonderland/smock";
import { ethers, upgrades } from "hardhat";
import {
  Clerk__factory,
  Clerk,
  SimpleToken,
  SimpleToken__factory,
  LatteSwapLiquidationStrategy__factory,
  LatteSwapLiquidationStrategy,
} from "../../../typechain/v8";
import {
  MockWBNB__factory,
  LatteSwapFactory,
  LatteSwapRouter,
  LatteSwapFactory__factory,
  LatteSwapRouter__factory,
} from "@latteswap/latteswap-contract/compiled-typechain";
import { BigNumber, constants, Wallet } from "ethers";
import { MockProvider } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export interface ILatteSwapLiquidationStrategyDTO {
  latteSwapLiquidationStrategy: LatteSwapLiquidationStrategy;
  clerk: Clerk;
  router: LatteSwapRouter;
  factory: LatteSwapFactory;
  token0: SimpleToken;
  token1: SimpleToken;
  deployer: SignerWithAddress;
  reserve0: BigNumber;
  reserve1: BigNumber;
}

export async function latteSwapLiquidationStrategyIntegrationTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<ILatteSwapLiquidationStrategyDTO> {
  const FOREVER = "2000000000";
  const [deployer] = await ethers.getSigners();
  const reserve0 = ethers.utils.parseEther("100000");
  const reserve1 = ethers.utils.parseEther("10000");

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

  const [token0, token1] = [stakingTokens[0], stakingTokens[1]];

  const Factory = new LatteSwapFactory__factory(deployer);
  const factory = await Factory.deploy(deployer.address);
  await factory.deployed();
  await factory.createPair(token0.address, token1.address);

  const Router = new LatteSwapRouter__factory(deployer);
  const router = await Router.deploy(factory.address, wbnb.address);

  await token0.approve(router.address, constants.MaxUint256);
  await token1.approve(router.address, constants.MaxUint256);

  await router.deployed();
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

  const LatteSwapLiquidationStrategy = (await ethers.getContractFactory(
    "LatteSwapLiquidationStrategy",
    deployer
  )) as LatteSwapLiquidationStrategy__factory;
  const latteSwapLiquidationStrategy = (await upgrades.deployProxy(LatteSwapLiquidationStrategy, [
    clerk.address,
    router.address,
  ])) as LatteSwapLiquidationStrategy;
  await latteSwapLiquidationStrategy.deployed();

  await clerk.whitelistMarket(latteSwapLiquidationStrategy.address, true);

  return {
    latteSwapLiquidationStrategy,
    clerk,
    router,
    factory,
    token0,
    token1,
    deployer,
    reserve0,
    reserve1,
  };
}
