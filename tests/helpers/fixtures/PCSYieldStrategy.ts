import { MockProvider } from "ethereum-waffle";
import { BigNumber, Signer, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  LatteSwapYieldStrategy__factory,
  LatteSwapYieldStrategy,
  SimpleToken,
  SimpleToken__factory,
  MockPCSMasterchef,
  MockPCSMasterchef__factory,
  PCSYieldStrategy,
  PCSYieldStrategy__factory,
} from "../../../typechain/v8";
import { LATTE, LATTE__factory, WNativeRelayer } from "@latteswap/latteswap-contract/compiled-typechain";
import { smock, MockContract } from "@defi-wonderland/smock";

export interface IPCSYieldStrategyDTO {
  stakingToken: SimpleToken;
  cake: SimpleToken;
  pcsYieldStrategy: PCSYieldStrategy;
  masterchef: MockContract<MockPCSMasterchef>;
  PID: number;
}

export async function pcsYieldStrategyUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<any> {
  const [deployer, bob, alice, dev] = await ethers.getSigners();
  const PID = 1;

  // Deploy CAKE
  const CAKE = new SimpleToken__factory(deployer);
  const cake = await CAKE.deploy();
  await cake.deployed();

  // Mint LATTE for testing purpose
  await cake.mint(await deployer.getAddress(), ethers.utils.parseEther("888888888"));

  // Deploy mocked stake tokens
  const StakingToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const stakingToken = (await StakingToken.deploy()) as SimpleToken;
  await stakingToken.deployed();

  // Deploy mocked PCS MasterChef
  const MockPCSMasterchef = await smock.mock<MockPCSMasterchef__factory>("MockPCSMasterchef", deployer);
  const masterchef: MockContract<MockPCSMasterchef> = await MockPCSMasterchef.deploy(
    cake.address,
    stakingToken.address
  );

  await cake.mint(masterchef.address, ethers.utils.parseEther("888888888"));

  await cake.transferOwnership(masterchef.address);

  await masterchef.setVariable("poolInfo", {
    [PID]: {
      lpToken: stakingToken.address,
    },
  });

  // Deploy PCSYieldStrategy
  const PCSYieldStrategy = (await ethers.getContractFactory("PCSYieldStrategy", deployer)) as PCSYieldStrategy__factory;

  const pcsYieldStrategy = (await upgrades.deployProxy(PCSYieldStrategy, [
    masterchef.address,
    stakingToken.address,
    PID, // mock pid
  ])) as PCSYieldStrategy;
  await pcsYieldStrategy.deployed();

  return {
    stakingToken,
    cake,
    pcsYieldStrategy,
    masterchef,
    PID,
  } as IPCSYieldStrategyDTO;
}
