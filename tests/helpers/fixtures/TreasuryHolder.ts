import { MockProvider } from "ethereum-waffle";
import { BaseContract, constants, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  Clerk__factory,
  SimpleToken__factory,
  Clerk,
  SimpleToken,
  FlatMarket__factory,
  FlatMarket,
  TreasuryHolder,
  TreasuryHolder__factory,
  FLAT,
  FLAT__factory,
  FlatMarketConfig__factory,
  CompositeOracle__factory,
  MockFlatMarketForTreasuryHolder,
  MockFlatMarketForTreasuryHolder__factory,
  FlatMarketConfig,
} from "../../../typechain/v8";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
import { LATTE, LATTE__factory, MockWBNB, MockWBNB__factory } from "@latteswap/latteswap-contract/compiled-typechain";

export type ITreasuryHolderUnitDTO = {
  deployer: SignerWithAddress;
  alice: Wallet;
  bob: Wallet;
  carol: SignerWithAddress;
  wbnb: MockWBNB;
  clerk: MockContract<Clerk>;
  stakingToken: SimpleToken;
  flat: FLAT;
  flatMarkets: Array<MockContract<MockFlatMarketForTreasuryHolder>>;
  treasuryHolder: TreasuryHolder;
  flatMarketConfig: FakeContract<BaseContract>;
  compositeOracle: FakeContract<BaseContract>;
};

export async function treasuryHolderUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<ITreasuryHolderUnitDTO> {
  const hours = 60 * 60;
  const [deployer, _a, _b, carol] = await ethers.getSigners();
  let sendtx;
  const alice = ethers.Wallet.createRandom().connect(ethers.provider);

  sendtx = await carol.sendTransaction({
    to: alice.address,
    value: ethers.utils.parseEther("10000"),
  });
  await sendtx.wait();
  const bob = ethers.Wallet.createRandom().connect(ethers.provider);
  sendtx = await carol.sendTransaction({
    to: bob.address,
    value: ethers.utils.parseEther("10000"),
  });
  await sendtx.wait();

  const MockWBNB = new MockWBNB__factory(deployer);
  const wbnb = await MockWBNB.deploy();
  await wbnb.deployed();

  const Flat = new FLAT__factory(deployer);
  const flat = await Flat.deploy(6 * hours, 3000);
  await flat.deployed();

  await flat.mint(await deployer.getAddress(), ethers.utils.parseEther("1000000000"));

  // Deploy Clerk
  const Clerk = await smock.mock<Clerk__factory>("Clerk", deployer);
  const clerk: MockContract<Clerk> = await Clerk.deploy();
  await clerk.initialize(wbnb.address);

  // Deploy mocked stake tokens
  const SimpleToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
  const simpleToken = (await SimpleToken.deploy()) as SimpleToken;
  await simpleToken.deployed();
  await simpleToken.mint(deployer.address, ethers.utils.parseEther("1000000000"));
  await simpleToken.mint(alice.address, ethers.utils.parseEther("1000000000"));
  await simpleToken.mint(bob.address, ethers.utils.parseEther("1000000000"));
  await simpleToken.mint(carol.address, ethers.utils.parseEther("1000000000"));

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
  const FlatMarket = await smock.mock<MockFlatMarketForTreasuryHolder__factory>("MockFlatMarketForTreasuryHolder");
  const flatMarkets = [];
  for (let i = 0; i < 2; i++) {
    const flatMarket = await FlatMarket.deploy();
    await flatMarket.initialize(
      clerk.address,
      flat.address,
      simpleToken.address,
      mockedFlatMarketConfig.address,
      mockedCompositeOracle.address,
      ethers.utils.defaultAbiCoder.encode(["address"], [constants.AddressZero])
    );
    flatMarkets.push(flatMarket);
  }
  // Deploy TreasuryHolder
  const TreasuryHolder = new TreasuryHolder__factory(deployer);
  const treasuryHolder = await upgrades.deployProxy(TreasuryHolder, [alice.address, clerk.address, flat.address]);
  await treasuryHolder.deployed();

  mockedFlatMarketConfig.treasury.returns(treasuryHolder.address);

  return {
    deployer,
    alice,
    bob,
    carol,
    wbnb,
    clerk,
    stakingToken: simpleToken,
    flat,
    treasuryHolder,
    flatMarkets,
    flatMarketConfig: mockedFlatMarketConfig,
    compositeOracle: mockedCompositeOracle,
  } as ITreasuryHolderUnitDTO;
}
