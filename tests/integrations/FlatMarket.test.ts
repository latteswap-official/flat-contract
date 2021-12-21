import { ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Signer, BigNumberish, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import {
  Clerk,
  Clerk__factory,
  CompositeOracle,
  CompositeOracle__factory,
  FLAT,
  FlatMarket,
  FlatMarketConfig,
  FlatMarketConfig__factory,
  FlatMarket__factory,
  FLAT__factory,
  LatteSwapYieldStrategy,
  LatteSwapYieldStrategy__factory,
  OffChainOracle,
  OffChainOracle__factory,
  SimpleToken,
  SimpleToken__factory,
  TreasuryHolder,
  TreasuryHolder__factory,
} from "../../typechain/v8";
import {
  BeanBagV2,
  BeanBagV2__factory,
  Booster,
  BoosterConfig,
  BoosterConfig__factory,
  Booster__factory,
  LatteSwapFactory,
  LatteSwapFactory__factory,
  LatteSwapRouter,
  LatteSwapRouter__factory,
  LATTE__factory,
  MasterBarista,
  MasterBarista__factory,
  MockWBNB,
  MockWBNB__factory,
  WNativeRelayer__factory,
} from "../../typechain/v6";
import { FOREVER, MAX_PRICE_DEVIATION } from "../helpers/constants";
import * as timeHelpers from "../helpers/time";
import * as debtHelpers from "../helpers/debt";
import { advanceBlockTo } from "../helpers/time";

chai.use(solidity);
const { expect } = chai;

describe("FlatMarket", () => {
  const DAY = ethers.BigNumber.from(24 * 60 * 60);
  const MAX_MINT_BPS = ethers.BigNumber.from(1500);
  const MIN_DEBT_SIZE = ethers.utils.parseEther("1");
  const LIQUIDATION_PENALTY = ethers.BigNumber.from("10500");
  const LIQUIDATION_TREASURY_BPS = ethers.BigNumber.from("1000");
  const MAX_COLLATERAL_RATIO = ethers.BigNumber.from("8500");
  const INTEREST_PER_SECOND = ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60);
  const CLOSE_FACTOR_BPS_10000 = 10000;

  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let bob: Signer;
  let cat: Signer;

  let deployerAddress: string;
  let aliceAddress: string;
  let bobAddress: string;
  let catAddress: string;

  // Contract instances
  // latteSwap
  let latteSwapFactory: LatteSwapFactory;
  let latteSwapRouter: LatteSwapRouter;
  let treasuryHolder: TreasuryHolder;

  // tokens
  let wbnb: MockWBNB;
  let usdt: SimpleToken;
  let usdc: SimpleToken;
  let usdcUsdtLp: SimpleToken;
  let flat: FLAT;

  // oracle
  let offChainOracle: OffChainOracle;
  let compositOracle: CompositeOracle;

  let clerk: Clerk;

  let usdcUsdtLpMarket: FlatMarket;
  let flatMarketConfig: FlatMarketConfig;

  // contract account
  let flatAsAlice: FLAT;
  let usdcUsdtLpAsAlice: SimpleToken;
  let usdcUsdtLpMarketAsAlice: FlatMarket;

  let flatAsBob: FLAT;
  let usdcUsdtLpAsBob: SimpleToken;
  let usdcUsdtLpMarketAsBob: FlatMarket;

  let flatAsCat: FLAT;
  let usdcUsdtLpAsCat: SimpleToken;
  let usdcUsdtLpMarketAsCat: FlatMarket;

  function calculateAccruedInterest(
    t0: BigNumberish,
    t1: BigNumberish,
    debt: BigNumberish,
    interestPerSecond: BigNumberish
  ): BigNumber {
    const t0b = BigNumber.from(t0);
    const t1b = BigNumber.from(t1);
    const debtb = BigNumber.from(debt);
    const interestPerSecondb = BigNumber.from(interestPerSecond);

    if (t0b.gt(t1b)) throw new Error("t0 must be less than t1");

    const timePast = t1b.sub(t0b);
    const accruedInterest = timePast.mul(debtb).mul(interestPerSecondb).div(ethers.constants.WeiPerEther);

    return accruedInterest;
  }

  async function fixture() {
    [deployer, alice, bob, cat] = await ethers.getSigners();
    [deployerAddress, aliceAddress, bobAddress, catAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      cat.getAddress(),
    ]);

    // Deploy WBNB
    const MockWBNB = (await ethers.getContractFactory("MockWBNB", deployer)) as MockWBNB__factory;
    wbnb = await MockWBNB.deploy();

    // Deploy LatteSwap
    const LatteSwapFactory = (await ethers.getContractFactory(
      "LatteSwapFactory",
      deployer
    )) as LatteSwapFactory__factory;
    latteSwapFactory = await LatteSwapFactory.deploy(await deployer.getAddress());

    const LatteSwapRouter = (await ethers.getContractFactory("LatteSwapRouter", deployer)) as LatteSwapRouter__factory;
    latteSwapRouter = await LatteSwapRouter.deploy(latteSwapFactory.address, wbnb.address);

    // Deploy USDC & USDT tokens
    const SimpleToken = (await ethers.getContractFactory("SimpleToken")) as SimpleToken__factory;
    usdc = await SimpleToken.deploy();
    await usdc.mint(deployerAddress, ethers.utils.parseEther("168168168168168"));
    usdt = await SimpleToken.deploy();
    await usdt.mint(deployerAddress, ethers.utils.parseEther("168168168168168"));

    // Create pair to get LP & provide liquidity
    await usdc.approve(latteSwapRouter.address, ethers.utils.parseEther("168168168168168"));
    await usdt.approve(latteSwapRouter.address, ethers.utils.parseEther("168168168168168"));
    await latteSwapRouter.addLiquidity(
      usdc.address,
      usdt.address,
      ethers.utils.parseEther("168168168168"),
      ethers.utils.parseEther("168168168168"),
      0,
      0,
      deployerAddress,
      FOREVER
    );
    usdcUsdtLp = SimpleToken__factory.connect(await latteSwapFactory.getPair(usdc.address, usdt.address), deployer);

    // Deploy Oracles
    // Use Offchain Oracle for easy testing
    const OffChainOracle = (await ethers.getContractFactory("OffChainOracle", deployer)) as OffChainOracle__factory;
    offChainOracle = (await upgrades.deployProxy(OffChainOracle, [])) as OffChainOracle;
    await offChainOracle.grantRole(ethers.utils.solidityKeccak256(["string"], ["FEEDER_ROLE"]), deployerAddress);

    // Feed offchain price
    await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [ethers.utils.parseEther("1")]);

    // Expect offchain price to be 1
    let [updated, price] = await offChainOracle.get(
      ethers.utils.defaultAbiCoder.encode(["address", "address"], [usdcUsdtLp.address, usdt.address])
    );
    expect(updated).to.be.true;
    expect(price).to.eq(ethers.utils.parseEther("1"));

    const CompositeOracle = (await ethers.getContractFactory("CompositeOracle", deployer)) as CompositeOracle__factory;
    compositOracle = (await upgrades.deployProxy(CompositeOracle, [15 * 60])) as CompositeOracle;
    await compositOracle.setPrimarySources(
      usdcUsdtLp.address,
      MAX_PRICE_DEVIATION,
      [offChainOracle.address],
      [ethers.utils.defaultAbiCoder.encode(["address", "address"], [usdcUsdtLp.address, usdt.address])]
    );

    await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

    // skip time to avoid time delay
    await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));

    // set price once again to let the `nextPrice` of a previous setPrices call move to `currentPrice)
    await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

    // Expect composit oracle can query from offchain oracle
    [updated, price] = await compositOracle.get(ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address]));
    expect(updated).to.be.true;
    expect(price).to.eq(ethers.utils.parseEther("1"));

    // Deploy Clerk
    const Clerk = (await ethers.getContractFactory("Clerk", deployer)) as Clerk__factory;
    clerk = (await upgrades.deployProxy(Clerk, [])) as Clerk;

    // Deploy FLAT
    const FLAT = (await ethers.getContractFactory("FLAT", deployer)) as FLAT__factory;
    flat = (await upgrades.deployProxy(FLAT, [DAY, MAX_MINT_BPS])) as FLAT;

    // Deploy MarketConfig
    const FlatMarketConfig = (await ethers.getContractFactory(
      "FlatMarketConfig",
      deployer
    )) as FlatMarketConfig__factory;
    flatMarketConfig = (await upgrades.deployProxy(FlatMarketConfig, [deployerAddress])) as FlatMarketConfig;

    expect(await flatMarketConfig.treasury()).to.be.eq(deployerAddress);

    // Deploy usdcUsdtLpMarket
    // Assuming 0.5% interest rate per year
    // Assuming 85% collateralization ratio
    const FlatMarket = (await ethers.getContractFactory("FlatMarket", deployer)) as FlatMarket__factory;
    usdcUsdtLpMarket = (await upgrades.deployProxy(FlatMarket, [
      clerk.address,
      flat.address,
      usdcUsdtLp.address,
      flatMarketConfig.address,
      compositOracle.address,
      ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address]),
    ])) as FlatMarket;

    // Deploy TreasuryHolder
    const TreasuryHolder = new TreasuryHolder__factory(deployer);
    treasuryHolder = (await upgrades.deployProxy(TreasuryHolder, [
      aliceAddress,
      clerk.address,
      flat.address,
    ])) as TreasuryHolder;
    await treasuryHolder.deployed();
    // Whitelist market to allow market to access funds in Clerk
    await clerk.whitelistMarket(usdcUsdtLpMarket.address, true);
    // Mint FLAT to deployer
    await flat.mint(deployerAddress, ethers.utils.parseEther("700000000"));
    // Increase timestamp by 1 day to allow more FLAT to be minted
    await timeHelpers.increaseTimestamp(timeHelpers.DAY);
    // Replenish FLAT to usdcUsdtLpMarket
    await flat.replenish(usdcUsdtLpMarket.address, ethers.utils.parseEther("100000000"), clerk.address);
    // Assuming someone try to borrow FLAT from usdcUsdtLpMarket when it is not setup yet
    await usdcUsdtLp.approve(clerk.address, ethers.constants.MaxUint256);
    await expect(
      usdcUsdtLpMarket.depositAndBorrow(
        deployerAddress,
        ethers.utils.parseEther("10000000"),
        ethers.utils.parseEther("8500000"),
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      ),
      "if oracle get stale > 1 day, it will be reverted as no valid source"
    ).to.be.revertedWith("CompositeOracle::get::price stale");
    // Feed offchain price again
    await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [ethers.utils.parseEther("1")]);
    // update composit oracle price after offchain feeding the latest price
    await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);
    await expect(
      usdcUsdtLpMarket.depositAndBorrow(
        deployerAddress,
        ethers.utils.parseEther("10000000"),
        ethers.utils.parseEther("8500000"),
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      )
    ).to.be.revertedWith("bad collateralFactor");
    // Config market
    await flatMarketConfig.setConfig(
      [usdcUsdtLpMarket.address],
      [
        {
          collateralFactor: MAX_COLLATERAL_RATIO,
          liquidationPenalty: LIQUIDATION_PENALTY,
          liquidationTreasuryBps: LIQUIDATION_TREASURY_BPS,
          interestPerSecond: INTEREST_PER_SECOND,
          minDebtSize: MIN_DEBT_SIZE,
          closeFactorBps: CLOSE_FACTOR_BPS_10000,
        },
      ]
    );
    // Connect contracts to Alice
    usdcUsdtLpAsAlice = SimpleToken__factory.connect(usdcUsdtLp.address, alice);
    usdcUsdtLpMarketAsAlice = FlatMarket__factory.connect(usdcUsdtLpMarket.address, alice);
    flatAsAlice = FLAT__factory.connect(flat.address, alice);

    // Conenct contracts to Bob
    usdcUsdtLpAsBob = SimpleToken__factory.connect(usdcUsdtLp.address, bob);
    usdcUsdtLpMarketAsBob = FlatMarket__factory.connect(usdcUsdtLpMarket.address, bob);
    flatAsBob = FLAT__factory.connect(flat.address, bob);

    // Connect contracts to Cat
    usdcUsdtLpAsCat = SimpleToken__factory.connect(usdcUsdtLp.address, cat);
    usdcUsdtLpMarketAsCat = FlatMarket__factory.connect(usdcUsdtLpMarket.address, cat);
    flatAsCat = FLAT__factory.connect(flat.address, cat);
    // Transfer usdcUsdtLp to Alice and Bob
    await usdcUsdtLp.transfer(aliceAddress, ethers.utils.parseEther("100000000"));
    await usdcUsdtLp.transfer(bobAddress, ethers.utils.parseEther("100000000"));
    // Approve clerk to deduct money
    await usdcUsdtLpAsAlice.approve(clerk.address, ethers.constants.MaxUint256);
    await usdcUsdtLpAsBob.approve(clerk.address, ethers.constants.MaxUint256);
    await usdcUsdtLpAsCat.approve(clerk.address, ethers.constants.MaxUint256);
    // Approve clerk to deduct money
    await flatAsAlice.approve(clerk.address, ethers.constants.MaxUint256);
    await flatAsBob.approve(clerk.address, ethers.constants.MaxUint256);
    await flatAsCat.approve(clerk.address, ethers.constants.MaxUint256);
  }

  beforeEach(async () => {
    await waffle.loadFixture(fixture);
  });

  describe("#initialzied", async () => {
    it("should be initialized", async () => {
      expect(await usdcUsdtLpMarket.clerk()).to.equal(clerk.address);
      expect(await usdcUsdtLpMarket.flat()).to.equal(flat.address);
      expect(await usdcUsdtLpMarket.collateral()).to.equal(usdcUsdtLp.address);
      expect(await usdcUsdtLpMarket.oracle()).to.equal(compositOracle.address);
      expect(await usdcUsdtLpMarket.oracleData()).to.equal(
        ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])
      );
      expect(await flatMarketConfig.interestPerSecond(usdcUsdtLpMarket.address)).to.equal(
        ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60)
      );
      expect(await flatMarketConfig.collateralFactor(usdcUsdtLpMarket.address, deployerAddress)).to.equal(
        MAX_COLLATERAL_RATIO
      );
      expect(await flatMarketConfig.liquidationPenalty(usdcUsdtLpMarket.address)).to.equal(LIQUIDATION_PENALTY);
      expect(await flatMarketConfig.liquidationTreasuryBps(usdcUsdtLpMarket.address)).to.equal(
        LIQUIDATION_TREASURY_BPS
      );
    });
  });

  describe("#accrue", async () => {
    it("should accrue interest correctly", async () => {
      // preparation
      const stages: any = {};
      const collateralAmount = ethers.utils.parseEther("10000000");
      const borrowAmount = ethers.utils.parseEther("1000000");

      // Move timestamp to start of the week for easy testing
      await timeHelpers.setTimestamp(
        (await timeHelpers.latestTimestamp()).div(timeHelpers.WEEK).add(1).mul(timeHelpers.WEEK)
      );

      // set price to prevent no valid source in case of stale
      await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [ethers.utils.parseEther("1")]);
      await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
      await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

      // Assuming Alice deposit "collateralAmount" USDC-USDT LP and borrow "borrowAmount" FLAT
      const aliceFlatBefore = await flat.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.depositAndBorrow(
        aliceAddress,
        collateralAmount,
        borrowAmount,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      );
      const aliceFlatAfter = await flat.balanceOf(aliceAddress);
      stages["aliceBorrow"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

      expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(borrowAmount);

      // Move timestamp to 52 weeks since Alice borrowed "borrowAmount" FLAT
      await timeHelpers.setTimestamp(
        (await timeHelpers.latestTimestamp()).div(timeHelpers.WEEK).add(52).mul(timeHelpers.WEEK)
      );
      stages["oneYearAfter"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

      // set price to prevent no valid source in case of stale
      await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [ethers.utils.parseEther("1")]);
      await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
      await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

      // Deposit 0 to accrue interest
      await usdcUsdtLpMarket.deposit(flat.address, deployerAddress, 0);
      stages["accrue"] = [await timeHelpers.latestTimestamp(), await timeHelpers.latestBlockNumber()];

      const timePast = stages["accrue"][0].sub(stages["aliceBorrow"][0]);
      const expectedSurplus = borrowAmount.mul(timePast).mul(INTEREST_PER_SECOND).div(ethers.constants.WeiPerEther);
      expect(await usdcUsdtLpMarket.lastAccrueTime()).to.be.eq(stages["accrue"][0]);
      expect(await usdcUsdtLpMarket.surplus()).to.be.eq(expectedSurplus);
      expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount.add(expectedSurplus));

      // Deployer withdraw surplus
      await usdcUsdtLpMarket.withdrawSurplus();
      const deployerFlatBefore = await flat.balanceOf(deployerAddress);
      await clerk.withdraw(flat.address, deployerAddress, deployerAddress, expectedSurplus, 0);
      const deployerFlatAfter = await flat.balanceOf(deployerAddress);

      expect(deployerFlatAfter.sub(deployerFlatBefore)).to.be.eq(expectedSurplus);
    });
  });

  describe("#addCollateral", async () => {
    const collateralAmount = ethers.utils.parseEther("10000000");

    beforeEach(async () => {
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, aliceAddress, collateralAmount);
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
    });

    context("when Alice deposit and add collateral more than what she has", async () => {
      it("should revert", async () => {
        // Alice add collateral more than she deposit
        // expect the transaction to revert
        await expect(usdcUsdtLpMarketAsAlice.addCollateral(ethers.constants.AddressZero, collateralAmount.add(1))).to.be
          .reverted;
      });
    });

    context("when Alice deposit and add collateral to her account", async () => {
      it("should work", async () => {
        // Alice add collateral
        await usdcUsdtLpMarketAsAlice.addCollateral(aliceAddress, collateralAmount);

        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
      });
    });

    context("when Alice deposit but add collateral to bob account", async () => {
      it("should work", async () => {
        // Alice add collateral to Bob account
        await usdcUsdtLpMarketAsAlice.addCollateral(bobAddress, collateralAmount);
        // Expect that Bob should credited collateral
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(collateralAmount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
        expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(collateralAmount);
      });
    });
  });

  describe("#borrow", async () => {
    const collateralAmount = ethers.utils.parseEther("10000000");

    beforeEach(async () => {
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, aliceAddress, collateralAmount);
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);

      // Alice add collateral to the market
      await usdcUsdtLpMarketAsAlice.addCollateral(aliceAddress, collateralAmount);

      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
    });

    context("when price < minPrice", async () => {
      it("should revert", async () => {
        // Alice borrow
        await expect(
          usdcUsdtLpMarketAsAlice.borrow(
            aliceAddress,
            collateralAmount,
            ethers.utils.parseEther("1.1"),
            ethers.utils.parseEther("1.1")
          )
        ).to.be.revertedWith("slippage");
      });
    });

    context("when price > maxPrice", async () => {
      it("should revert", async () => {
        // Alice borrow
        await expect(
          usdcUsdtLpMarketAsAlice.borrow(
            aliceAddress,
            collateralAmount,
            ethers.utils.parseEther("0.8"),
            ethers.utils.parseEther("0.8")
          )
        ).to.be.revertedWith("slippage");
      });
    });

    context("when price input weird", async () => {
      it("should revert", async () => {
        // Alice borrow
        await expect(
          usdcUsdtLpMarketAsAlice.borrow(
            aliceAddress,
            collateralAmount,
            ethers.utils.parseEther("1.2"),
            ethers.utils.parseEther("0.8")
          )
        ).to.be.revertedWith("slippage");
      });
    });

    context("when Alice borrows to her account", async () => {
      context("when she borrows more than MAX_COLLATERAL_RATIO", async () => {
        it("should revert", async () => {
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(10000).add(1);

          // Alice borrow
          await expect(
            usdcUsdtLpMarketAsAlice.borrow(
              aliceAddress,
              borrowAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            )
          ).to.be.revertedWith("!safe");
        });
      });

      context("when she borrow more than what her collateral", async () => {
        it("should revert", async () => {
          const borrowAmount = collateralAmount.add(1);

          // Alice borrow more than what she has as collateral
          await expect(
            usdcUsdtLpMarketAsAlice.borrow(
              aliceAddress,
              borrowAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            )
          ).to.be.revertedWith("!safe");
        });
      });

      context("when she borrows 50% of her collateral", async () => {
        it("should work", async () => {
          // preparation
          const borrowAmount = collateralAmount.div(2);

          // Alice borrow
          const lastAccrueTime = await usdcUsdtLpMarket.lastAccrueTime();
          const marketFlatBalanceOnClerkBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatBefore = await flat.balanceOf(aliceAddress);
          await usdcUsdtLpMarketAsAlice.borrow(
            aliceAddress,
            borrowAmount,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
          const marketFlatBalanceOnClerkAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatAfter = await flat.balanceOf(aliceAddress);

          expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(0);
          expect(marketFlatBalanceOnClerkBefore.sub(marketFlatBalanceOnClerkAfter)).to.be.eq(borrowAmount);
          expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.lastAccrueTime()).to.be.gt(lastAccrueTime);
        });
      });

      context("when she borrows MAX_COLLATERAL_RATIO of her collateral", async () => {
        it("should work", async () => {
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(10000);

          // Alice borrow
          const lastAccrueTime = await usdcUsdtLpMarket.lastAccrueTime();
          const marketFlatBalanceOnClerkBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatBefore = await flat.balanceOf(aliceAddress);
          await usdcUsdtLpMarketAsAlice.borrow(
            aliceAddress,
            borrowAmount,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
          const marketFlatBalanceOnClerkAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatAfter = await flat.balanceOf(aliceAddress);

          expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(0);
          expect(marketFlatBalanceOnClerkBefore.sub(marketFlatBalanceOnClerkAfter)).to.be.eq(borrowAmount);
          expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.lastAccrueTime()).to.be.gt(lastAccrueTime);
        });
      });
    });

    context("when Alice borrows to Bob account", async () => {
      context("when she borrows more than MAX_COLLATERAL_RATIO", async () => {
        it("should revert", async () => {
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(10000).add(1);

          // Alice borrow to Bob account
          await expect(
            usdcUsdtLpMarketAsAlice.borrow(
              bobAddress,
              borrowAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            )
          ).to.be.revertedWith("!safe");
        });
      });

      context("when she borrows more than her collateral", async () => {
        it("should revert", async () => {
          const borrowAmount = collateralAmount.add(1);

          // Alice borrow to Bob account more than what she has as collateral
          await expect(
            usdcUsdtLpMarketAsAlice.borrow(
              bobAddress,
              borrowAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            )
          ).to.be.revertedWith("!safe");
        });
      });

      context("when she borrows 50% of her collateral", async () => {
        it("should work", async () => {
          // preparation
          const borrowAmount = collateralAmount.div(2);

          // Alice borrow to Bob account
          const lastAccrueTime = await usdcUsdtLpMarket.lastAccrueTime();
          const marketFlatBalanceOnClerkBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatBefore = await flat.balanceOf(aliceAddress);
          const bobFlatBefore = await flat.balanceOf(bobAddress);
          await usdcUsdtLpMarketAsAlice.borrow(
            bobAddress,
            borrowAmount,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
          const marketFlatBalanceOnClerkAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatAfter = await flat.balanceOf(aliceAddress);
          const bobFlatAfter = await flat.balanceOf(bobAddress);

          expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(0);
          expect(bobFlatAfter.sub(bobFlatBefore)).to.be.eq(0);
          expect(marketFlatBalanceOnClerkBefore.sub(marketFlatBalanceOnClerkAfter)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.lastAccrueTime()).to.be.gt(lastAccrueTime);
          expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(flat.address, bobAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(bobAddress)).to.be.eq(0);
        });
      });

      context("when she borrows MAX_COLLATERAL_RATIO of her collateral", async () => {
        it("should work", async () => {
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(10000);

          // Alice borrow to Bob account
          const lastAccrueTime = await usdcUsdtLpMarket.lastAccrueTime();
          const marketFlatBalanceOnClerkBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatBefore = await flat.balanceOf(aliceAddress);
          const bobFlatBefore = await flat.balanceOf(bobAddress);
          await usdcUsdtLpMarketAsAlice.borrow(
            bobAddress,
            borrowAmount,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
          const marketFlatBalanceOnClerkAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          const aliceFlatAfter = await flat.balanceOf(aliceAddress);
          const bobFlatAfter = await flat.balanceOf(bobAddress);

          expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(0);
          expect(bobFlatAfter.sub(bobFlatBefore)).to.be.eq(0);
          expect(marketFlatBalanceOnClerkBefore.sub(marketFlatBalanceOnClerkAfter)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.lastAccrueTime()).to.be.gt(lastAccrueTime);
          expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(flat.address, bobAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(bobAddress)).to.be.eq(0);
        });
      });
    });
  });

  describe("#deposit", async () => {
    context("when msg.sender and '_to' is the same person", async () => {
      it("should take token from msg.sender and credit msg.sender", async () => {
        const amount = ethers.utils.parseEther("10000000");
        const aliceBefore = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, aliceAddress, amount);
        const aliceAfter = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);

        expect(aliceBefore.sub(aliceAfter)).to.be.eq(amount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(amount);
      });
    });

    context("when msg.sender is not the same as '_to'", async () => {
      it("should take token from msg.sender and credit '_to'", async () => {
        const amount = ethers.utils.parseEther("10000000");
        const aliceBefore = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, bobAddress, amount);
        const aliceAfter = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);

        expect(aliceBefore.sub(aliceAfter)).to.be.eq(amount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(amount);
      });
    });
  });

  describe("#depositAndAddCollateral", async () => {
    context("integrated with booster", () => {
      const LATTE_PER_BLOCK = ethers.utils.parseEther("1");
      const LATTE_START_BLOCK = 0;
      const stages: Record<string, BigNumberish> = {};
      let masterBarista: MasterBarista, booster: Booster, latteSwapYieldStrategy: LatteSwapYieldStrategy;
      beforeEach(async () => {
        // Deploy LATTE
        const LATTE = new LATTE__factory(deployer);
        const latteToken = await LATTE.deploy(await deployer.getAddress(), 132, 137);
        await latteToken.deployed();

        // Deploy BeanBagV2
        const BeanBagV2Factory = (await ethers.getContractFactory("BeanBagV2", deployer)) as BeanBagV2__factory;
        const beanV2 = (await upgrades.deployProxy(BeanBagV2Factory, [latteToken.address])) as BeanBagV2;
        await beanV2.deployed();

        // Deploy MasterBarista
        const MasterBaristaFactory = (await ethers.getContractFactory(
          "MasterBarista",
          deployer
        )) as MasterBarista__factory;
        masterBarista = (await upgrades.deployProxy(MasterBaristaFactory, [
          latteToken.address,
          beanV2.address,
          await deployer.getAddress(),
          LATTE_PER_BLOCK,
          LATTE_START_BLOCK,
        ])) as MasterBarista;
        await masterBarista.deployed();

        // set beanv2 owner to master barista
        await beanV2.transferOwnership(masterBarista.address);
        await latteToken.transferOwnership(masterBarista.address);

        const BoosterConfigFactory = (await ethers.getContractFactory(
          "BoosterConfig",
          deployer
        )) as BoosterConfig__factory;
        const boosterConfig = (await upgrades.deployProxy(BoosterConfigFactory, [])) as BoosterConfig;
        await boosterConfig.deployed();

        const WBNB = await ethers.getContractFactory("MockWBNB", deployer);
        const wbnb = await WBNB.deploy();
        await wbnb.deployed();

        const WNativeRelayer = (await ethers.getContractFactory("WNativeRelayer", deployer)) as WNativeRelayer__factory;
        const wNativeRelayer = await WNativeRelayer.deploy(wbnb.address);
        await await wNativeRelayer.deployed();

        const BoosterFactory = (await ethers.getContractFactory("Booster", deployer)) as Booster__factory;
        booster = (await upgrades.deployProxy(BoosterFactory, [
          latteToken.address,
          masterBarista.address,
          boosterConfig.address,
          wNativeRelayer.address,
          wbnb.address,
        ])) as Booster;
        await booster.deployed();

        await boosterConfig.setStakeTokenAllowance(usdcUsdtLp.address, true);
        await masterBarista.setStakeTokenCallerAllowancePool(usdcUsdtLp.address, true);
        await masterBarista.addStakeTokenCallerContract(usdcUsdtLp.address, booster.address);
        await masterBarista.addPool(usdcUsdtLp.address, ethers.utils.parseEther("1"));
        await masterBarista.setPool(latteToken.address, ethers.utils.parseEther("0"));

        await wNativeRelayer.setCallerOk([booster.address], true);

        const LatteSwapYieldStrategyFactory = (await ethers.getContractFactory(
          "LatteSwapYieldStrategy",
          deployer
        )) as LatteSwapYieldStrategy__factory;
        latteSwapYieldStrategy = (await upgrades.deployProxy(LatteSwapYieldStrategyFactory, [
          booster.address,
          usdcUsdtLp.address,
        ])) as LatteSwapYieldStrategy;
        await latteSwapYieldStrategy.deployed();
        await latteSwapYieldStrategy.setTreasuryAccount(catAddress);

        await clerk.setStrategy(usdcUsdtLp.address, latteSwapYieldStrategy.address);
        await clerk.setStrategyTargetBps(usdcUsdtLp.address, 10000);
        await latteSwapYieldStrategy.grantRole(await latteSwapYieldStrategy.STRATEGY_CALLER_ROLE(), clerk.address);
      });

      context("when multiple add collateral", async () => {
        it("should have a correct collateral added as well as a reward and reward debt", async () => {
          const amount = ethers.utils.parseEther("10000000");
          const aliceBefore = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);
          //get current block
          const block = await ethers.provider.getBlockNumber();
          stages["aliceDepositAndAddCollateralBlock"] = block + 1;
          await usdcUsdtLpMarket.connect(alice).depositAndAddCollateral(bobAddress, amount);
          const aliceAfter = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);

          await advanceBlockTo(stages["aliceDepositAndAddCollateralBlock"] + 2);
          stages["aliceDepositAndAddCollateralBlock"] = stages["aliceDepositAndAddCollateralBlock"] + 2;
          let expectedAccumRewardPerShare = LATTE_PER_BLOCK.mul(constants.WeiPerEther).mul(2).div(amount);
          let expectedReward = expectedAccumRewardPerShare.mul(amount).div(constants.WeiPerEther);
          expect(await masterBarista.pendingLatte(usdcUsdtLp.address, latteSwapYieldStrategy.address)).to.eq(
            expectedReward
          );

          expectedAccumRewardPerShare = expectedAccumRewardPerShare.add(
            LATTE_PER_BLOCK.mul(constants.WeiPerEther).div(amount)
          );
          expectedReward = expectedAccumRewardPerShare.mul(amount).div(constants.WeiPerEther);
          await clerk.connect(bob)["harvest(address)"](usdcUsdtLp.address);
          stages["aliceDepositAndAddCollateralBlock"] = stages["aliceDepositAndAddCollateralBlock"] + 1;
          expect(
            await latteSwapYieldStrategy.rewardDebts(bobAddress),
            "reward debts should be eq to expected reward"
          ).to.eq(expectedReward);
          expect(
            await latteSwapYieldStrategy.accRewardPerShare(),
            "acc reward pershare should be eq to expected one"
          ).to.eq(expectedAccumRewardPerShare.mul(ethers.utils.parseUnits("1", 9)));

          expect(aliceBefore.sub(aliceAfter)).to.be.eq(amount);
          expect(await usdcUsdtLp.balanceOf(clerk.address), "move all tokens to the strategy").to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(amount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(amount);

          expectedAccumRewardPerShare = expectedAccumRewardPerShare.add(
            LATTE_PER_BLOCK.mul(constants.WeiPerEther).div(amount)
          );
          expectedReward = expectedAccumRewardPerShare.mul(amount).div(constants.WeiPerEther);
          await usdcUsdtLpMarket.connect(alice).depositAndAddCollateral(aliceAddress, amount);
          stages["aliceDepositAndAddCollateralBlock"] = stages["aliceDepositAndAddCollateralBlock"] + 1;
          expect(
            await latteSwapYieldStrategy.rewardDebts(aliceAddress),
            "reward debts should be eq to expected reward"
          ).to.eq(expectedReward);
          expect(
            await latteSwapYieldStrategy.accRewardPerShare(),
            "acc reward pershare should be eq to expected one"
          ).to.eq(expectedAccumRewardPerShare.mul(ethers.utils.parseUnits("1", 9)));

          expectedAccumRewardPerShare = expectedAccumRewardPerShare.add(
            LATTE_PER_BLOCK.mul(constants.WeiPerEther).div(amount.add(amount))
          );
          expectedReward = expectedAccumRewardPerShare.mul(amount.add(amount)).div(constants.WeiPerEther);
          await usdcUsdtLpMarket.connect(alice).depositAndAddCollateral(bobAddress, amount);
          stages["aliceDepositAndAddCollateralBlock"] = stages["aliceDepositAndAddCollateralBlock"] + 1;
          expect(
            await latteSwapYieldStrategy.rewardDebts(bobAddress),
            "reward debts should be eq to expected reward"
          ).to.eq(expectedReward);
          expect(
            await latteSwapYieldStrategy.accRewardPerShare(),
            "acc reward pershare should be eq to expected one"
          ).to.eq(expectedAccumRewardPerShare.mul(ethers.utils.parseUnits("1", 9)));
        });
      });
    });

    context("when msg.sender and '_to' is the same person", async () => {
      it("should take token from msg.sender and credit msg.sender", async () => {
        const amount = ethers.utils.parseEther("10000000");
        const aliceBefore = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.depositAndAddCollateral(aliceAddress, amount);
        const aliceAfter = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);

        expect(aliceBefore.sub(aliceAfter)).to.be.eq(amount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(amount);
      });
    });

    context("when msg.sender is not the same as '_to'", async () => {
      it("should take token from msg.sender and credit '_to'", async () => {
        const amount = ethers.utils.parseEther("10000000");
        const aliceBefore = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.depositAndAddCollateral(bobAddress, amount);
        const aliceAfter = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);

        expect(aliceBefore.sub(aliceAfter)).to.be.eq(amount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
        expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(amount);
      });
    });
  });

  describe("#depositAndBorrow", async () => {
    context("when price went below _minPrice", async () => {
      it("should revert", async () => {
        // preparation
        // set price to 0.5
        await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [ethers.utils.parseEther("0.5")]);

        // clear the price cache
        await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
        await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);
        await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
        await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

        await expect(
          usdcUsdtLpMarketAsAlice.depositAndBorrow(
            aliceAddress,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          )
        ).to.be.revertedWith("slippage");
      });
    });

    context("when price went above _maxPrice", async () => {
      it("should revert", async () => {
        // preparation
        // set price to 1.5
        await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [ethers.utils.parseEther("1.5")]);

        // clear the price cache
        await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
        await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);
        await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
        await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

        await expect(
          usdcUsdtLpMarketAsAlice.depositAndBorrow(
            aliceAddress,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          )
        ).to.be.revertedWith("slippage");
      });
    });

    context("when collateral is not enough to borrow FLAT", async () => {
      it("should revert", async () => {
        // Alice try to borrow 8,500,001 FLAT with 10,000,000 usdcUsdtLp as collateral
        // This should revert due to _collateralFactor is 85% and collateral is only 10,000,000.
        await expect(
          usdcUsdtLpMarketAsAlice.depositAndBorrow(
            aliceAddress,
            ethers.utils.parseEther("10000000"),
            ethers.utils.parseEther("8500001"),
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1.1")
          )
        ).to.be.revertedWith("!safe");
      });
    });

    context("when there is no FLAT left to borrow", async () => {
      it("should revert", async () => {
        // Reduce supply of FLAT to 0
        await usdcUsdtLpMarket.reduceSupply(await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address));

        // Assuming USDC-USDT LP worth 1 USD
        // Alice deposit 10,000,000 USDC-USDT LP and borrow 1 wei of FLAT
        await expect(
          usdcUsdtLpMarketAsAlice.depositAndBorrow(
            aliceAddress,
            ethers.utils.parseEther("10000000"),
            1,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1.1")
          )
        ).to.be.reverted;
      });
    });

    context("when borrow 50% of collateral", async () => {
      it("should deposit and borrow", async () => {
        // Assuming USDC-USDT LP worth 1 USD
        // Alice deposit 10,000,000 USDC-USDT LP and borrow 5,000,000 FLAT (50% collateral ratio)
        const aliceFlatBefore = await flat.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.depositAndBorrow(
          aliceAddress,
          ethers.utils.parseEther("10000000"),
          ethers.utils.parseEther("5000000"),
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1.1")
        );
        const aliceFlatAfter = await flat.balanceOf(aliceAddress);

        expect(aliceFlatAfter.sub(aliceFlatBefore)).to.eq(ethers.utils.parseEther("5000000"));
      });
    });

    context("when borrow at MAX_COLLATERAL_RATIO", async () => {
      it("should deposit and borrow", async () => {
        // Assuming USDC-USDT LP worth 1 USD
        // Alice deposit 10,000,000 USDC-USDT LP and borrow 10,000,000 * MAX_COLLATERAL_RATIO
        const aliceFlatBefore = await flat.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.depositAndBorrow(
          aliceAddress,
          ethers.utils.parseEther("10000000"),
          ethers.utils.parseEther("8500000"),
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1.1")
        );
        const aliceFlatAfter = await flat.balanceOf(aliceAddress);

        expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(ethers.utils.parseEther("8500000"));

        // Alice try to borrow 1 wei of FLAT
        // Expect to be revert
        await expect(
          usdcUsdtLpMarketAsAlice.borrow(aliceAddress, 1, ethers.utils.parseEther("1"), ethers.utils.parseEther("1"))
        ).to.be.revertedWith("!safe");
      });
    });
  });

  describe("#depositAndRepay", async () => {
    const collateralAmount = ethers.utils.parseEther("5000000");
    const borrowAmount = collateralAmount.div(2);
    const repayFunds = borrowAmount;
    let totalDebtValue = ethers.BigNumber.from(0);
    let totalDebtShare = ethers.BigNumber.from(0);
    const stages: any = {};

    beforeEach(async () => {
      // Reset debt value
      totalDebtValue = ethers.BigNumber.from(0);
      totalDebtShare = ethers.BigNumber.from(0);

      // Alice deposit and borrow FLAT
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.depositAndBorrow(
        aliceAddress,
        collateralAmount,
        borrowAmount,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      );
      stages["aliceDepositAndBorrow"] = [await timeHelpers.latestTimestamp()];
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount);

      // Update totalDebtShare
      // Alice is the first borrower, so her share is equal to the total debt share and equal to her borrowAmount
      totalDebtShare = totalDebtShare.add(borrowAmount);
      totalDebtValue = totalDebtValue.add(borrowAmount);

      expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
      expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
    });

    context("when Alice repay to her account", async () => {
      context("when she repay all borrowed FLAT", async () => {
        context("when there are some interests left and less than min debt size", () => {
          it("should revert as invalid debt size", async () => {
            await expect(usdcUsdtLpMarketAsAlice.depositAndRepay(aliceAddress, repayFunds)).to.be.revertedWith(
              "invalid debt size"
            );
          });
        });
        context("when are some interests left and gte min debt size", () => {
          it("should successfully repay with some interests left", async () => {
            const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
            await usdcUsdtLpMarketAsAlice.depositAndRepay(aliceAddress, repayFunds.sub(ethers.utils.parseEther("1")));
            const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
            stages["aliceDepositAndRepay"] = [await timeHelpers.latestTimestamp()];

            totalDebtValue = totalDebtValue.add(
              calculateAccruedInterest(
                stages["aliceDepositAndBorrow"][0],
                stages["aliceDepositAndRepay"][0],
                totalDebtValue,
                INTEREST_PER_SECOND
              )
            );

            expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(
              repayFunds.sub(ethers.utils.parseEther("1"))
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
            expect(
              await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress))
            ).to.be.eq(totalDebtValue.sub(repayFunds.sub(ethers.utils.parseEther("1"))));
          });
        });

        context("when there is 0 dust", () => {
          it("should successfully repay", async () => {
            const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
            const totalDebtShareBefore = await usdcUsdtLpMarket.totalDebtShare();

            stages["aliceDepositAndRepay"] = [await timeHelpers.latestTimestamp()];
            totalDebtValue = totalDebtValue.add(
              calculateAccruedInterest(
                stages["aliceDepositAndBorrow"][0],
                stages["aliceDepositAndRepay"][0].add(2),
                totalDebtValue,
                INTEREST_PER_SECOND
              )
            );

            const expectedAliceDebtShare = debtHelpers.debtShareToValue(
              repayFunds,
              totalDebtShareBefore,
              totalDebtValue
            );
            const interest = expectedAliceDebtShare.sub(repayFunds);
            await flat.mint(aliceAddress, interest);
            stages["aliceDepositAndRepay"] = [await timeHelpers.latestTimestamp()];

            await usdcUsdtLpMarketAsAlice.depositAndRepay(aliceAddress, constants.MaxUint256);
            const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);

            expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds.add(interest));
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
            expect(
              await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress))
            ).to.be.eq(0);
          });
        });
      });
    });

    context("when Bob repay for Alice account", async () => {
      const bobCollateralAmount = ethers.utils.parseEther("10000000");
      const bobBorrowAmount = bobCollateralAmount.div(2);

      beforeEach(async () => {
        // Bob deposit and borrow FLAT
        const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
        const totalDebtShareBefore = await usdcUsdtLpMarket.totalDebtShare();
        await usdcUsdtLpMarketAsBob.depositAndBorrow(
          bobAddress,
          bobCollateralAmount,
          bobBorrowAmount,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);
        stages["bobDepositAndBorrow"] = [await timeHelpers.latestTimestamp()];

        const accruedInterest = calculateAccruedInterest(
          stages["aliceDepositAndBorrow"][0],
          stages["bobDepositAndBorrow"][0],
          totalDebtValue,
          INTEREST_PER_SECOND
        );
        totalDebtValue = totalDebtValue.add(accruedInterest);

        const expectedBobDebtShare = debtHelpers.debtValueToShare(
          bobBorrowAmount,
          totalDebtShareBefore,
          totalDebtValue
        );

        const expectedTotalCollateral = collateralAmount.add(bobCollateralAmount);
        expect(bobUsdcUsdtLpBefore.sub(bobUsdcUsdtLpAfter)).to.be.eq(bobCollateralAmount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(bobCollateralAmount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(expectedTotalCollateral);
        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(expectedTotalCollateral);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
        expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
        expect(await usdcUsdtLpMarket.userDebtShare(bobAddress)).to.be.eq(expectedBobDebtShare);
        expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount.add(expectedBobDebtShare));
        expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue.add(bobBorrowAmount));

        // Update totalDebtShare
        totalDebtShare = totalDebtShare.add(expectedBobDebtShare);
        totalDebtValue = totalDebtValue.add(bobBorrowAmount);

        expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
        expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
      });

      context("when he repay all borrowed FLAT except interest", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsBob.depositAndRepay(aliceAddress, repayFunds);
          const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          stages["bobRepay"] = [await timeHelpers.latestTimestamp()];

          totalDebtValue = totalDebtValue.add(
            calculateAccruedInterest(
              stages["bobDepositAndBorrow"][0],
              stages["bobRepay"][0],
              totalDebtValue,
              INTEREST_PER_SECOND
            )
          );

          // Calculate Alice's debtValue, Alice's debtShare is equal to her borrowAmount
          const expectedDebtShareToDeduct = debtHelpers.debtValueToShare(repayFunds, totalDebtShare, totalDebtValue);
          const expectedAliceDebtShare = borrowAmount.sub(expectedDebtShareToDeduct);
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(
            expectedAliceDebtShare,
            totalDebtShare.sub(expectedDebtShareToDeduct),
            totalDebtValue.sub(repayFunds)
          );

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.add(bobCollateralAmount));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(expectedAliceDebtShare);
          expect(await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress))).to.be.eq(
            expectedAliceDebtValue
          );
        });
      });

      context("when he repay all borrowed FLAT + interest", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsBob.depositAndRepay(aliceAddress, ethers.constants.MaxUint256);
          const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          stages["bobRepay"] = [await timeHelpers.latestTimestamp()];

          totalDebtValue = totalDebtValue.add(
            calculateAccruedInterest(
              stages["bobDepositAndBorrow"][0],
              stages["bobRepay"][0],
              totalDebtValue,
              INTEREST_PER_SECOND
            )
          );

          // Calculate Alice's debtValue, Alice's debtShare is equal to her borrowAmount
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(borrowAmount, totalDebtShare, totalDebtValue);

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(expectedAliceDebtValue);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.add(bobCollateralAmount));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(0);
        });
      });
    });
  });

  describe("#depositRepayAndWithdraw", async () => {
    const collateralAmount = ethers.utils.parseEther("10000000");

    beforeEach(async () => {
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.depositAndAddCollateral(aliceAddress, collateralAmount);
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
    });

    context("when Alice has no debt", async () => {
      context("when '_for' & '_to' is her account", async () => {
        context("when she remove collateral more than she has", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                aliceAddress,
                ethers.constants.MaxUint256,
                collateralAmount.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.reverted;
          });
        });

        context("when she remove all her collateral", async () => {
          it("should work", async () => {
            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
              aliceAddress,
              ethers.constants.MaxUint256,
              collateralAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
            expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
          });
        });
      });

      context("when '_for' & '_to' is Bob account", async () => {
        context("when she remove collateral more than she has", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                bobAddress,
                ethers.constants.MaxUint256,
                collateralAmount.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.reverted;
          });
        });

        context("when she remove all her collateral", async () => {
          it("should work", async () => {
            const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
            await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
              bobAddress,
              ethers.constants.MaxUint256,
              collateralAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

            expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
            expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(0);
          });
        });
      });
    });

    context("when Alice has debt", async () => {
      const borrowAmount = collateralAmount.div(2);
      const aliceMinCollateral = borrowAmount.mul(10000).div(MAX_COLLATERAL_RATIO);
      const canRemoveCollateral = collateralAmount.sub(aliceMinCollateral);

      beforeEach(async () => {
        // Turn off interest before borrow
        await flatMarketConfig.setConfig(
          [usdcUsdtLpMarket.address],
          [
            {
              collateralFactor: MAX_COLLATERAL_RATIO,
              liquidationPenalty: LIQUIDATION_PENALTY,
              liquidationTreasuryBps: LIQUIDATION_TREASURY_BPS,
              interestPerSecond: 0,
              minDebtSize: MIN_DEBT_SIZE,
              closeFactorBps: CLOSE_FACTOR_BPS_10000,
            },
          ]
        );

        await usdcUsdtLpMarketAsAlice.borrowAndWithdraw(
          aliceAddress,
          borrowAmount,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );

        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
        expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(0);
        expect(await flat.balanceOf(aliceAddress)).to.be.eq(borrowAmount);
      });

      context("when '_for' & '_to' is her account", async () => {
        context("when she not return any debt", async () => {
          context(
            "when her position went over MAX_COLLATERAL_RATIO after she does depositRepayAndWithdraw",
            async () => {
              it("should revert", async () => {
                await expect(
                  usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                    aliceAddress,
                    "0",
                    canRemoveCollateral.add(1),
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1")
                  )
                ).to.be.revertedWith("!safe");
              });
            }
          );

          context("when her position still safe after she does depositRepayAndWithdraw", async () => {
            it("should work", async () => {
              // removeCollateral = canRemoveCollateral - 1 wei to round down
              const removeCollateral = canRemoveCollateral.sub(1);

              const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
              await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                aliceAddress,
                "0",
                removeCollateral,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
              const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

              expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
              expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
            });
          });
        });

        context("when she return debt", async () => {
          const returnAmount = ethers.BigNumber.from("1");
          const aliceMinCollateralIfReturn = borrowAmount.sub(returnAmount).mul(10000).div(MAX_COLLATERAL_RATIO);
          const aliceCanRemoveCollateralIfReturn = collateralAmount.sub(aliceMinCollateralIfReturn);

          context(
            "when her position went over MAX_COLLATERAL_RATIO after she does depositRepayAndWithdraw",
            async () => {
              it("should revert", async () => {
                await expect(
                  usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                    aliceAddress,
                    returnAmount,
                    aliceCanRemoveCollateralIfReturn,
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1")
                  )
                ).to.be.revertedWith("!safe");
              });
            }
          );

          context("when her position still safe after she does depositRepayAndWithdraw", async () => {
            it("should work", async () => {
              // removeCollateral = canRemoveCollateral - 3 wei to margin rounding error
              const removeCollateral = aliceCanRemoveCollateralIfReturn.sub(3);

              const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
              await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                aliceAddress,
                "0",
                removeCollateral,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
              const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

              expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
              expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
            });
          });
        });
      });

      context("when '_for' & '_to' is Bob account", async () => {
        context("when she not return any debt for Bob", async () => {
          context(
            "when her position went over MAX_COLLATERAL_RATIO after she does depositRepayAndWithdraw",
            async () => {
              it("should revert", async () => {
                await expect(
                  usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                    bobAddress,
                    "0",
                    canRemoveCollateral.add(1),
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1")
                  )
                ).to.be.revertedWith("!safe");
              });
            }
          );

          context("when her position still safe after she does depositRepayAndWithdraw", async () => {
            it("should work", async () => {
              // removeCollateral = canRemoveCollateral - 1 wei to round down
              const removeCollateral = canRemoveCollateral.sub(1);

              const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
              const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
              await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                bobAddress,
                "0",
                removeCollateral,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
              const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);
              const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

              expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
              expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
              expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
            });
          });
        });

        context("when she return debt", async () => {
          const returnAmount = ethers.BigNumber.from("1");
          const aliceMinCollateralIfReturn = borrowAmount.sub(returnAmount).mul(10000).div(MAX_COLLATERAL_RATIO);
          const aliceCanRemoveCollateralIfReturn = collateralAmount.sub(aliceMinCollateralIfReturn);

          context(
            "when her position went over MAX_COLLATERAL_RATIO after she does depositRepayAndWithdraw",
            async () => {
              it("should revert", async () => {
                await expect(
                  usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                    bobAddress,
                    returnAmount,
                    aliceCanRemoveCollateralIfReturn,
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1")
                  )
                ).to.be.revertedWith("!safe");
              });
            }
          );

          context("when her position still safe after she does depositRepayAndWithdraw", async () => {
            it("should work", async () => {
              // removeCollateral = canRemoveCollateral - 1 wei to margin rounding error
              const removeCollateral = aliceCanRemoveCollateralIfReturn.sub(3);

              const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
              const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
              await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                bobAddress,
                returnAmount,
                removeCollateral,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
              const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);
              const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

              expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
              expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
              expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
            });
          });
        });
      });

      context("when Bob has debt", async () => {
        const borrowAmount = collateralAmount.div(2);

        beforeEach(async () => {
          // Turn off interest before borrow
          await flatMarketConfig.setConfig(
            [usdcUsdtLpMarket.address],
            [
              {
                collateralFactor: MAX_COLLATERAL_RATIO,
                liquidationPenalty: LIQUIDATION_PENALTY,
                liquidationTreasuryBps: LIQUIDATION_TREASURY_BPS,
                interestPerSecond: 0,
                minDebtSize: MIN_DEBT_SIZE,
                closeFactorBps: CLOSE_FACTOR_BPS_10000,
              },
            ]
          );

          await usdcUsdtLpMarketAsBob.depositAndBorrow(
            bobAddress,
            collateralAmount,
            borrowAmount,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );

          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.mul(2));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(0);
          expect(await flat.balanceOf(bobAddress)).to.be.eq(borrowAmount);
        });
      });
    });
  });

  describe("#kill", async () => {
    const aliceCollateralAmount = ethers.utils.parseEther("10000000");
    const aliceBorrowAmount = aliceCollateralAmount.mul(5000).div(10000);
    const bobCollateralAmount = ethers.utils.parseEther("10000000");
    const bobBorrowAmount = bobCollateralAmount.mul(MAX_COLLATERAL_RATIO.sub("1000")).div(10000);
    const stages: any = {};
    let accruedInterest = ethers.BigNumber.from(0);
    let totalDebtShare = ethers.BigNumber.from(0);
    let totalDebtValue = ethers.BigNumber.from(0);

    beforeEach(async () => {
      // Reset variables
      accruedInterest = ethers.BigNumber.from(0);
      totalDebtShare = ethers.BigNumber.from(0);
      totalDebtValue = ethers.BigNumber.from(0);

      // set Treasury to be a Treasury Holder
      await flatMarketConfig.setTreasury(treasuryHolder.address);
      expect(await flatMarketConfig.treasury(), "expect flat market config's treasury to be a treasury holder").to.eq(
        treasuryHolder.address
      );

      // Alice borrow FLAT using 50% of her collateral
      const aliceFlatBefore = await flat.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.depositAndBorrow(
        aliceAddress,
        aliceCollateralAmount,
        aliceBorrowAmount,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      );
      stages["aliceDepositAndBorrow"] = await timeHelpers.latestTimestamp();
      const aliceFlatAfter = await flat.balanceOf(aliceAddress);
      totalDebtShare = totalDebtShare.add(aliceBorrowAmount);
      totalDebtValue = aliceBorrowAmount;

      expect(aliceFlatAfter.sub(aliceFlatBefore)).to.be.eq(aliceBorrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
      expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);

      // Bob borrow FLAT using MAX_COLLATERAL_RATIO - 10% (margin for immediate liquidate) of his collateral
      const bobFlatBefore = await flat.balanceOf(bobAddress);
      await usdcUsdtLpMarketAsBob.depositAndBorrow(
        bobAddress,
        bobCollateralAmount,
        bobBorrowAmount,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      );
      stages["bobDepositAndBorrow"] = await timeHelpers.latestTimestamp();
      const bobFlatAfter = await flat.balanceOf(bobAddress);
      // Calculate totalDebtValue at accrue
      const interest = accruedInterest.add(
        calculateAccruedInterest(
          stages["aliceDepositAndBorrow"],
          stages["bobDepositAndBorrow"],
          totalDebtValue,
          INTEREST_PER_SECOND
        )
      );
      accruedInterest = accruedInterest.add(interest);
      totalDebtValue = totalDebtValue.add(interest);
      // Calculate totalDebtShare when debt is added to Bob
      totalDebtShare = totalDebtShare.add(
        debtHelpers.debtValueToShare(bobBorrowAmount, totalDebtShare, totalDebtValue)
      );
      // Add bob's borrow amount to totalDebtValue
      totalDebtValue = totalDebtValue.add(bobBorrowAmount);

      expect(bobFlatAfter.sub(bobFlatBefore)).to.be.eq(bobBorrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
      expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
    });

    context("when all positions are safe", async () => {
      it("should revert", async () => {
        await expect(
          usdcUsdtLpMarket.kill(
            [aliceAddress, bobAddress],
            [aliceBorrowAmount, bobBorrowAmount],
            deployerAddress,
            ethers.constants.AddressZero
          )
        ).to.be.revertedWith("all healthy");
      });
    });

    context("when Bob position is not safe", async () => {
      context("when Bob's position is NOT bad debt", async () => {
        const collateralPrice = ethers.utils.parseEther("0.87");

        beforeEach(async () => {
          // Set Oracle price to USDC-USDT LP to 0.87 so that Bob position is liquidatable
          await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [collateralPrice]);

          // clear the price cache
          await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
          await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);
          await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
          await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

          // Expect composit oracle can query from offchain oracle
          const [updated, price] = await compositOracle.get(
            ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])
          );
          expect(updated).to.be.true;
          expect(price).to.eq(collateralPrice);

          // Build up FLAT balance sheet for cat to liquidate
          await flat.transfer(catAddress, ethers.utils.parseEther("10000000"));
          const catFlatBefore = await clerk.balanceOf(flat.address, catAddress);
          await usdcUsdtLpMarketAsCat.deposit(flat.address, catAddress, ethers.utils.parseEther("10000000"));
          stages["catDeposit"] = await timeHelpers.latestTimestamp();
          const catFlatAfter = await clerk.balanceOf(flat.address, catAddress);
          // Calculate totalDebtValue at accrue
          const interest = calculateAccruedInterest(
            stages["bobDepositAndBorrow"],
            stages["catDeposit"],
            totalDebtValue,
            INTEREST_PER_SECOND
          );
          accruedInterest = accruedInterest.add(interest);
          totalDebtValue = totalDebtValue.add(interest);

          expect(catFlatAfter.sub(catFlatBefore)).to.be.eq(ethers.utils.parseEther("10000000"));
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
        });

        context("when liquidator fully kill both Bob and Alice", async () => {
          it("should only kill Bob's position", async () => {
            const aliceDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(aliceAddress);
            const aliceCollateralBefore = await usdcUsdtLpMarket.userCollateralShare(aliceAddress);
            const bobDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            const bobCollateralBefore = await usdcUsdtLpMarket.userCollateralShare(bobAddress);
            const catFlatBefore = await clerk.balanceOf(flat.address, catAddress);
            await usdcUsdtLpMarketAsCat.kill(
              [aliceAddress, bobAddress],
              [ethers.constants.MaxUint256, ethers.constants.MaxUint256],
              catAddress,
              ethers.constants.AddressZero
            );
            stages["catKill"] = await timeHelpers.latestTimestamp();
            const aliceDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(aliceAddress);
            const aliceCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(aliceAddress);
            const bobDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            const bobCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(bobAddress);
            const catFlatAfter = await clerk.balanceOf(flat.address, catAddress);
            // Calculate totalDebtValue at accrue
            let interest = calculateAccruedInterest(
              stages["catDeposit"],
              stages["catKill"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            // Calculate Bob's debt value to be removed
            const bobDebtValue = debtHelpers.debtShareToValue(bobDebtShareBefore, totalDebtShare, totalDebtValue);
            // Calculate totalDebtShare when debt is removed from Bob
            totalDebtShare = totalDebtShare.sub(bobDebtShareBefore);
            // Calculate totalDebtValue after Bob's position is killed
            totalDebtValue = totalDebtValue.sub(bobDebtValue);
            // Calculate collateral to be taken from Bob
            const liquidatedCollateral = bobDebtValue
              .mul(LIQUIDATION_PENALTY)
              .mul(ethers.constants.WeiPerEther)
              .div(collateralPrice.mul(1e4));
            // Calculate liquidation fee
            const liquidationFee = bobDebtValue
              .mul(LIQUIDATION_PENALTY)
              .div(1e4)
              .sub(bobDebtValue)
              .mul(LIQUIDATION_TREASURY_BPS)
              .div(1e4);

            // Expect that totalDebtValue and totalDebtShare must correct
            expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);

            expect(aliceDebtShareAfter).to.be.eq(aliceDebtShareBefore);
            expect(aliceCollateralBefore).to.be.eq(aliceCollateralAfter);
            expect(bobDebtShareAfter).to.be.eq(0);
            expect(bobCollateralBefore.sub(bobCollateralAfter)).to.be.eq(liquidatedCollateral);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(liquidationFee);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(accruedInterest);
            expect(catFlatBefore.sub(catFlatAfter)).to.be.eq(bobDebtValue.add(liquidationFee));

            // Treasury withdraw surplus, expect to get both accruedInterest and liquidation fee
            const treasuryFlatBefore = await clerk.balanceOf(flat.address, treasuryHolder.address);
            await treasuryHolder.collectSurplus([usdcUsdtLpMarket.address]);
            stages["withdrawSurplus"] = await timeHelpers.latestTimestamp();
            // Calculate totalDebtValue at accrue
            interest = calculateAccruedInterest(
              stages["catKill"],
              stages["withdrawSurplus"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            const treasuryFlatAfter = await clerk.balanceOf(flat.address, treasuryHolder.address);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
            expect(treasuryFlatAfter.sub(treasuryFlatBefore)).to.be.eq(accruedInterest.add(liquidationFee));

            expect(
              await treasuryHolder.totalBadDebtValue(),
              "if no bad debt, should not update the market count"
            ).to.be.eq(0);
            expect(
              await treasuryHolder.badDebtMarkets(usdcUsdtLpMarket.address),
              "if no bad dent, should not update bad debt markets"
            ).to.be.eq(0);
          });
        });

        context("when liquidator partially kill Bob", async () => {
          it("should only settle debt that liquidator liquidate", async () => {
            const bobDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            const bobCollateralBefore = await usdcUsdtLpMarket.userCollateralShare(bobAddress);
            const catFlatBefore = await clerk.balanceOf(flat.address, catAddress);
            const liquidateDebtShare = bobDebtShareBefore.div(2);
            await usdcUsdtLpMarketAsCat.kill(
              [bobAddress],
              [liquidateDebtShare],
              catAddress,
              ethers.constants.AddressZero
            );
            stages["catKill"] = await timeHelpers.latestTimestamp();
            const bobDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            const bobCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(bobAddress);
            const catFlatAfter = await clerk.balanceOf(flat.address, catAddress);
            // Calculate totalDebtValue at accrue
            let interest = calculateAccruedInterest(
              stages["catDeposit"],
              stages["catKill"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            // Calculate Bob's debt value to be removed, it should take all Bob's collateral
            const bobDebtValue = debtHelpers.debtShareToValue(liquidateDebtShare, totalDebtShare, totalDebtValue);
            // Calculate totalDebtShare when debt is removed from Bob
            totalDebtShare = totalDebtShare.sub(liquidateDebtShare);
            // Calculate totalDebtValue after Bob's position is killed
            totalDebtValue = totalDebtValue.sub(bobDebtValue);
            // Calculate collateral to be taken from Bob
            const liquidatedCollateral = bobDebtValue
              .mul(LIQUIDATION_PENALTY)
              .mul(ethers.constants.WeiPerEther)
              .div(collateralPrice.mul(1e4));
            // Calculate liquidation fee
            const liquidationFee = bobDebtValue
              .mul(LIQUIDATION_PENALTY)
              .div(1e4)
              .sub(bobDebtValue)
              .mul(LIQUIDATION_TREASURY_BPS)
              .div(1e4);

            // Expect that totalDebtValue and totalDebtShare must correct
            expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);

            expect(bobDebtShareAfter).to.be.eq(bobDebtShareBefore.sub(liquidateDebtShare));
            expect(bobCollateralBefore.sub(bobCollateralAfter)).to.be.eq(liquidatedCollateral);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(liquidationFee);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(accruedInterest);
            expect(catFlatBefore.sub(catFlatAfter)).to.be.eq(bobDebtValue.add(liquidationFee));

            // Treasury withdraw surplus, expect to get both accruedInterest and liquidation fee
            const treasuryFlatBefore = await clerk.balanceOf(flat.address, treasuryHolder.address);
            await treasuryHolder.collectSurplus([usdcUsdtLpMarket.address]);
            stages["withdrawSurplus"] = await timeHelpers.latestTimestamp();
            // Calculate totalDebtValue at accrue
            interest = calculateAccruedInterest(
              stages["catKill"],
              stages["withdrawSurplus"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            const treasuryFlatAfter = await clerk.balanceOf(flat.address, treasuryHolder.address);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
            expect(treasuryFlatAfter.sub(treasuryFlatBefore)).to.be.eq(accruedInterest.add(liquidationFee));

            expect(
              await treasuryHolder.totalBadDebtValue(),
              "if no bad debt, should not update the market count"
            ).to.be.eq(0);
            expect(
              await treasuryHolder.badDebtMarkets(usdcUsdtLpMarket.address),
              "if no bad dent, should not update bad debt markets"
            ).to.be.eq(0);
          });
        });
      });

      context("when Bob's position is bad debt", async () => {
        const collateralPrice = ethers.utils.parseEther("0.75");

        beforeEach(async () => {
          // Set Oracle price to USDC-USDT LP to 0.75 so that Bob position is bad debt
          await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [collateralPrice]);

          // clear the price cache
          await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
          await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);
          await timeHelpers.increaseTimestamp(timeHelpers.duration.minutes(BigNumber.from("15")));
          await compositOracle.setPrices([ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])]);

          // Expect composit oracle can query from offchain oracle
          const [updated, price] = await compositOracle.get(
            ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address])
          );
          expect(updated).to.be.true;
          expect(price).to.eq(collateralPrice);

          // Build up FLAT balance sheet for cat to liquidate
          await flat.transfer(catAddress, ethers.utils.parseEther("10000000"));
          const catFlatBefore = await clerk.balanceOf(flat.address, catAddress);
          await usdcUsdtLpMarketAsCat.deposit(flat.address, catAddress, ethers.utils.parseEther("10000000"));
          stages["catDeposit"] = await timeHelpers.latestTimestamp();
          const catFlatAfter = await clerk.balanceOf(flat.address, catAddress);
          // Calculate totalDebtValue at accrue
          const interest = calculateAccruedInterest(
            stages["bobDepositAndBorrow"],
            stages["catDeposit"],
            totalDebtValue,
            INTEREST_PER_SECOND
          );
          accruedInterest = accruedInterest.add(interest);
          totalDebtValue = totalDebtValue.add(interest);

          expect(catFlatAfter.sub(catFlatBefore), "FLAT owned by cat should be 10000000").to.be.eq(
            ethers.utils.parseEther("10000000")
          );
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
        });

        context("when liquidator try to fully kill both Bob and Alice", async () => {
          it("should only kill Bob's position and liquidator should take all collateral", async () => {
            const aliceDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(aliceAddress);
            const aliceCollateralBefore = await usdcUsdtLpMarket.userCollateralShare(aliceAddress);
            const bobDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            await usdcUsdtLpMarketAsCat.kill(
              [aliceAddress, bobAddress],
              [ethers.constants.MaxUint256, ethers.constants.MaxUint256],
              catAddress,
              ethers.constants.AddressZero
            );
            stages["catKill"] = await timeHelpers.latestTimestamp();
            const aliceDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(aliceAddress);
            const aliceCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(aliceAddress);
            const bobDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            const bobCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(bobAddress);
            // Calculate totalDebtValue at accrue
            let interest = calculateAccruedInterest(
              stages["catDeposit"],
              stages["catKill"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            // Calculate expected debtShare to be taken from Bob
            const bobTakenDebtValue = bobCollateralAmount
              .mul(collateralPrice)
              .mul(1e4)
              .div(ethers.constants.WeiPerEther.mul(LIQUIDATION_PENALTY));
            const bobTakenDebtShare = debtHelpers.debtValueToShare(bobTakenDebtValue, totalDebtShare, totalDebtValue);
            const badDebtValue = debtHelpers.debtShareToValue(
              bobDebtShareBefore.sub(bobTakenDebtShare),
              totalDebtShare,
              totalDebtValue
            );
            const liquidationFee = bobTakenDebtValue
              .mul(LIQUIDATION_PENALTY)
              .div(1e4)
              .sub(bobTakenDebtValue)
              .mul(LIQUIDATION_TREASURY_BPS)
              .div(1e4);
            // Calculate totalDebtShare when debt is removed from Bob
            totalDebtShare = totalDebtShare.sub(bobDebtShareBefore);
            // Calculate totalDebtValue after Bob's position is killed
            totalDebtValue = totalDebtValue.sub(bobTakenDebtValue.add(badDebtValue));
            // Expect that totalDebtValue and totalDebtShare must correct
            expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
            expect(aliceDebtShareAfter).to.be.eq(aliceDebtShareBefore);
            expect(aliceCollateralBefore).to.be.eq(aliceCollateralAfter);
            expect(bobDebtShareAfter).to.be.eq(0);
            expect(bobCollateralAfter).to.be.eq(0);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(accruedInterest);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(liquidationFee);
            expect(await usdcUsdtLpMarket.userDebtShare(treasuryHolder.address)).to.be.eq(0);
            const userDebtValue = await usdcUsdtLpMarket.debtShareToValue(bobDebtShareBefore.sub(bobTakenDebtShare));

            // TreasuryHolder collect surplus, expect to get both accruedInterest and liquidation fee
            const treasuryFlatBefore = await clerk.balanceOf(flat.address, treasuryHolder.address);
            await treasuryHolder.collectSurplus([usdcUsdtLpMarket.address]);
            stages["withdrawSurplus"] = await timeHelpers.latestTimestamp();
            // Calculate totalDebtValue at accrue
            interest = calculateAccruedInterest(
              stages["catKill"],
              stages["withdrawSurplus"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            const treasuryFlatAfter = await clerk.balanceOf(flat.address, treasuryHolder.address);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
            expect(treasuryFlatAfter.sub(treasuryFlatBefore)).to.be.eq(accruedInterest.add(liquidationFee));
            expect(await treasuryHolder.totalBadDebtValue()).to.be.eq(userDebtValue);
            expect(await treasuryHolder.badDebtMarkets(usdcUsdtLpMarket.address)).to.be.eq(userDebtValue);
            await expect(treasuryHolder.withdrawSurplus()).to.be.revertedWith(
              "TreasuryHolder::withdrawSurplus:: there are still bad debt markets"
            );
            // deployer deposit some flat to treasury holder so that it can settle bad debt
            const extraDeposit = ethers.utils.parseEther("168");
            await flat.approve(clerk.address, ethers.constants.MaxUint256);
            await clerk.deposit(
              flat.address,
              deployerAddress,
              treasuryHolder.address,
              userDebtValue.sub(treasuryFlatAfter).add(extraDeposit),
              0
            );
            // treasury holder operations
            await expect(treasuryHolder.settleBadDebt([usdcUsdtLpMarket.address]))
              .to.emit(treasuryHolder, "LogBadDebt")
              .withArgs(usdcUsdtLpMarket.address, userDebtValue);
            expect(await treasuryHolder.totalBadDebtValue(), "bad debt should be 0").to.be.eq(0);
            expect(
              await treasuryHolder.badDebtMarkets(usdcUsdtLpMarket.address),
              "bad debt market for usdcUsdt should be false"
            ).to.be.eq(0);
            const aliceFlatBefore = await flat.balanceOf(aliceAddress);
            await treasuryHolder.withdrawSurplus();
            expect(
              (await flat.balanceOf(aliceAddress)).sub(aliceFlatBefore),
              "168 FLAT should be sent back to the eoa account"
            ).to.eq(extraDeposit);
          });
        });

        context("when liquidator try to partially kill Bob and left dust", async () => {
          it("should make liquidator to take all collateral", async () => {
            // Calculate expected debtShare to be taken from Bob
            const bobTakenDebtValue = bobCollateralAmount
              .mul(collateralPrice)
              .mul(1e4)
              .div(LIQUIDATION_PENALTY.mul(ethers.constants.WeiPerEther));
            // Calculate bobTakenDebtShare by a given bobTokenDebtValue
            // Need to minus dust to make dust happened
            const bobTakenDebtShare = debtHelpers
              .debtValueToShare(bobTakenDebtValue, totalDebtShare, totalDebtValue)
              .sub(ethers.utils.parseEther("0.1"));

            const aliceDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(aliceAddress);
            const aliceCollateralBefore = await usdcUsdtLpMarket.userCollateralShare(aliceAddress);
            const bobDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            await usdcUsdtLpMarketAsCat.kill(
              [bobAddress],
              [bobTakenDebtShare],
              catAddress,
              ethers.constants.AddressZero
            );
            stages["catKill"] = await timeHelpers.latestTimestamp();
            const aliceDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(aliceAddress);
            const aliceCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(aliceAddress);
            const bobDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(bobAddress);
            const bobCollateralAfter = await usdcUsdtLpMarket.userCollateralShare(bobAddress);
            // Calculate totalDebtValue at accrue
            let interest = calculateAccruedInterest(
              stages["catDeposit"],
              stages["catKill"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            // Calculate expected debtShare to be taken from Bob
            const bobActualTakenDebtShare = debtHelpers.debtValueToShare(
              bobTakenDebtValue,
              totalDebtShare,
              totalDebtValue
            );
            const badDebtValue = debtHelpers.debtShareToValue(
              bobDebtShareBefore.sub(bobActualTakenDebtShare),
              totalDebtShare,
              totalDebtValue
            );
            const liquidationFee = bobTakenDebtValue
              .mul(LIQUIDATION_PENALTY)
              .div(1e4)
              .sub(bobTakenDebtValue)
              .mul(LIQUIDATION_TREASURY_BPS)
              .div(1e4);
            // Calculate totalDebtShare when debt is removed from Bob
            totalDebtShare = totalDebtShare.sub(bobDebtShareBefore);
            // Calculate totalDebtValue after Bob's position is killed
            totalDebtValue = totalDebtValue.sub(bobTakenDebtValue.add(badDebtValue));

            // Expect that totalDebtValue and totalDebtShare must correct
            expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);

            expect(aliceDebtShareAfter).to.be.eq(aliceDebtShareBefore);
            expect(aliceCollateralBefore).to.be.eq(aliceCollateralAfter);
            expect(bobDebtShareAfter).to.be.eq(0);
            expect(bobCollateralAfter).to.be.eq(0);
            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(accruedInterest);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(liquidationFee);
            expect(await usdcUsdtLpMarket.userDebtShare(treasuryHolder.address)).to.be.eq(0);

            const userDebtValue = await usdcUsdtLpMarket.debtShareToValue(
              bobDebtShareBefore.sub(bobActualTakenDebtShare)
            );
            // Treasury withdraw surplus, expect to get both accruedInterest and liquidation fee
            const treasuryFlatBefore = await clerk.balanceOf(flat.address, treasuryHolder.address);
            await treasuryHolder.collectSurplus([usdcUsdtLpMarket.address]);
            stages["withdrawSurplus"] = await timeHelpers.latestTimestamp();
            // Calculate totalDebtValue at accrue
            interest = calculateAccruedInterest(
              stages["catKill"],
              stages["withdrawSurplus"],
              totalDebtValue,
              INTEREST_PER_SECOND
            );
            accruedInterest = accruedInterest.add(interest);
            totalDebtValue = totalDebtValue.add(interest);
            const treasuryFlatAfter = await clerk.balanceOf(flat.address, treasuryHolder.address);

            expect(await usdcUsdtLpMarket.surplus()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.liquidationFee()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
            expect(treasuryFlatAfter.sub(treasuryFlatBefore)).to.be.eq(accruedInterest.add(liquidationFee));
            expect(await treasuryHolder.totalBadDebtValue()).to.be.eq(userDebtValue);
            expect(await treasuryHolder.badDebtMarkets(usdcUsdtLpMarket.address)).to.be.eq(userDebtValue);

            await expect(treasuryHolder.withdrawSurplus()).to.be.revertedWith(
              "TreasuryHolder::withdrawSurplus:: there are still bad debt markets"
            );
            // deployer deposit some flat to treasury holder so that it can settle bad debt
            const extraDeposit = ethers.utils.parseEther("168");
            await flat.approve(clerk.address, ethers.constants.MaxUint256);
            await clerk.deposit(
              flat.address,
              deployerAddress,
              treasuryHolder.address,
              userDebtValue.sub(treasuryFlatAfter).add(extraDeposit),
              0
            );
            // treasury holder operations
            await expect(treasuryHolder.settleBadDebt([usdcUsdtLpMarket.address]))
              .to.emit(treasuryHolder, "LogBadDebt")
              .withArgs(usdcUsdtLpMarket.address, userDebtValue);
            expect(await treasuryHolder.totalBadDebtValue(), "bad debt should be 0").to.be.eq(0);
            expect(
              await treasuryHolder.badDebtMarkets(usdcUsdtLpMarket.address),
              "bad debt market for usdcUsdt should be false"
            ).to.be.eq(0);
            const aliceFlatBefore = await flat.balanceOf(aliceAddress);
            await treasuryHolder.withdrawSurplus();
            expect(
              (await flat.balanceOf(aliceAddress)).sub(aliceFlatBefore),
              "168 FLAT should be sent back to the eoa account"
            ).to.eq(extraDeposit);
          });
        });
      });
    });
  });

  describe("#removeCollateral", async () => {
    const collateralAmount = ethers.utils.parseEther("10000000");

    beforeEach(async () => {
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, aliceAddress, collateralAmount);
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);

      await usdcUsdtLpMarketAsAlice.addCollateral(aliceAddress, collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
    });

    context("when Alice has no debt", async () => {
      context("when she remove to her account", async () => {
        context("when she remove collateral more than she add", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateral(
                aliceAddress,
                collateralAmount.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.reverted;
          });
        });

        context("when she remove collateral as much as she add", async () => {
          it("should work", async () => {
            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateral(
              aliceAddress,
              collateralAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
            expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
          });
        });
      });

      context("when she remove to Bob account", async () => {
        context("when she remove collateral more than she add", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateral(
                bobAddress,
                collateralAmount.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.reverted;
          });
        });

        context("when she remove collateral as much as she add", async () => {
          it("should work", async () => {
            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateral(
              bobAddress,
              collateralAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(collateralAmount);
            expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
          });
        });
      });
    });

    context("when Alice has debt", async () => {
      const borrowAmount = collateralAmount.div(2);
      const aliceMinCollateral = borrowAmount.mul(10000).div(MAX_COLLATERAL_RATIO);
      const canRemoveCollateral = collateralAmount.sub(aliceMinCollateral);

      beforeEach(async () => {
        // Turn off interest before borrow
        await flatMarketConfig.setConfig(
          [usdcUsdtLpMarket.address],
          [
            {
              collateralFactor: MAX_COLLATERAL_RATIO,
              liquidationPenalty: LIQUIDATION_PENALTY,
              liquidationTreasuryBps: LIQUIDATION_TREASURY_BPS,
              interestPerSecond: 0,
              minDebtSize: MIN_DEBT_SIZE,
              closeFactorBps: CLOSE_FACTOR_BPS_10000,
            },
          ]
        );

        await usdcUsdtLpMarketAsAlice.borrow(
          aliceAddress,
          borrowAmount,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );

        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
        expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
      });

      context("when she remove to her account", async () => {
        context("when her position went over MAX_COLLATERAL_RATIO after she removed collateral", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateral(
                aliceAddress,
                canRemoveCollateral.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.revertedWith("!safe");
          });
        });

        context("when her position still safe after she removed collateral", async () => {
          it("should work", async () => {
            // removeCollateral = canRemoveCollateral - 1 wei to round down
            const removeCollateral = canRemoveCollateral.sub(1);

            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateral(
              aliceAddress,
              removeCollateral,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
          });
        });
      });

      context("when she remove to Bob account", async () => {
        context("when her position went over MAX_COLLATERAL_RAITO after she removed collateral", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateral(
                bobAddress,
                canRemoveCollateral.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.revertedWith("!safe");
          });
        });

        context("when her position still safe after she removed collateral", async () => {
          it("should work", async () => {
            // removeCollateral = canRemoveCollateral - 1 wei to round down
            const removeCollateral = canRemoveCollateral.sub(1);

            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateral(
              bobAddress,
              removeCollateral,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(removeCollateral);
            expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
          });
        });
      });
    });
  });

  describe("#removeCollateralAndWithdraw", async () => {
    const collateralAmount = ethers.utils.parseEther("10000000");

    beforeEach(async () => {
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, aliceAddress, collateralAmount);
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);

      await usdcUsdtLpMarketAsAlice.addCollateral(aliceAddress, collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
    });

    context("when Alice has no debt", async () => {
      context("when she remove to her account", async () => {
        context("when she remove collateral more than she add", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
                aliceAddress,
                collateralAmount.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.reverted;
          });
        });

        context("when she remove collateral as much as she add", async () => {
          it("should work", async () => {
            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
              aliceAddress,
              collateralAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
            expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
          });
        });
      });

      context("when she remove to Bob account", async () => {
        context("when she remove collateral more than she add", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
                bobAddress,
                collateralAmount.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.reverted;
          });
        });

        context("when she remove collateral as much as she add", async () => {
          it("should work", async () => {
            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
              bobAddress,
              collateralAmount,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);
            const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
            expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
            expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(0);
          });
        });
      });
    });

    context("when Alice has debt", async () => {
      const borrowAmount = collateralAmount.div(2);
      const aliceMinCollateral = borrowAmount.mul(10000).div(MAX_COLLATERAL_RATIO);
      const canRemoveCollateral = collateralAmount.sub(aliceMinCollateral);

      beforeEach(async () => {
        // Turn off interest before borrow
        await flatMarketConfig.setConfig(
          [usdcUsdtLpMarket.address],
          [
            {
              collateralFactor: MAX_COLLATERAL_RATIO,
              liquidationPenalty: LIQUIDATION_PENALTY,
              liquidationTreasuryBps: LIQUIDATION_TREASURY_BPS,
              interestPerSecond: 0,
              minDebtSize: MIN_DEBT_SIZE,
              closeFactorBps: CLOSE_FACTOR_BPS_10000,
            },
          ]
        );

        await usdcUsdtLpMarketAsAlice.borrow(
          aliceAddress,
          borrowAmount,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );

        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
        expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
      });

      context("when she remove to her account", async () => {
        context("when her position went over MAX_COLLATERAL_RATIO after she removed collateral", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
                aliceAddress,
                canRemoveCollateral.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.revertedWith("!safe");
          });
        });

        context("when her position still safe after she removed collateral", async () => {
          it("should work", async () => {
            // removeCollateral = canRemoveCollateral - 1 wei to round down
            const removeCollateral = canRemoveCollateral.sub(1);

            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
              aliceAddress,
              removeCollateral,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
          });
        });
      });

      context("when she remove to Bob account", async () => {
        context("when her position went over MAX_COLLATERAL_RAITO after she removed collateral", async () => {
          it("should revert", async () => {
            await expect(
              usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
                bobAddress,
                canRemoveCollateral.add(1),
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              )
            ).to.be.revertedWith("!safe");
          });
        });

        context("when her position still safe after she removed collateral", async () => {
          it("should work", async () => {
            // removeCollateral = canRemoveCollateral - 1 wei to round down
            const removeCollateral = canRemoveCollateral.sub(1);

            const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
            const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
            await usdcUsdtLpMarketAsAlice.removeCollateralAndWithdraw(
              bobAddress,
              removeCollateral,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
            const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);
            const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

            expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(0);
            expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
            expect(await clerk.balanceOf(flat.address, aliceAddress)).to.be.eq(borrowAmount);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.sub(removeCollateral));
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
          });
        });
      });
    });
  });

  describe("#repay", async () => {
    const collateralAmount = ethers.utils.parseEther("5000000");
    const borrowAmount = collateralAmount.div(2);
    const repayFunds = borrowAmount;
    let totalDebtValue = ethers.BigNumber.from(0);
    let totalDebtShare = ethers.BigNumber.from(0);
    const stages: any = {};

    beforeEach(async () => {
      // Reset debt value
      totalDebtValue = ethers.BigNumber.from(0);
      totalDebtShare = ethers.BigNumber.from(0);

      // Alice deposit and borrow FLAT
      const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
      await usdcUsdtLpMarketAsAlice.depositAndBorrow(
        aliceAddress,
        collateralAmount,
        borrowAmount,
        ethers.utils.parseEther("1"),
        ethers.utils.parseEther("1")
      );
      stages["aliceDepositAndBorrow"] = [await timeHelpers.latestTimestamp()];
      const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

      expect(aliceUsdcUsdtLpBefore.sub(aliceUsdcUsdtLpAfter)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
      expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount);
      expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(borrowAmount);

      // Update totalDebtShare
      // Alice is the first borrower, so her share is equal to the total debt share and equal to her borrowAmount
      totalDebtShare = totalDebtShare.add(borrowAmount);

      // Alice deposit FLAT to Clerk for repaying the debt
      await usdcUsdtLpMarketAsAlice.deposit(flat.address, aliceAddress, repayFunds);
      stages["aliceDeposit"] = [await timeHelpers.latestTimestamp()];

      totalDebtValue = borrowAmount.add(
        calculateAccruedInterest(
          stages["aliceDepositAndBorrow"][0],
          stages["aliceDeposit"][0],
          borrowAmount,
          INTEREST_PER_SECOND
        )
      );
    });

    context("when Alice repay to her account", async () => {
      context("when she try repay more than what she has in Clerk", async () => {
        it("should revert", async () => {
          await expect(usdcUsdtLpMarketAsAlice.repay(aliceAddress, repayFunds.add(1))).to.be.reverted;
        });
      });

      context("when she repay all borrowed FLAT", async () => {
        context("when valid debt size", () => {
          it("should have some interest left", async () => {
            const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
            await usdcUsdtLpMarketAsAlice.repay(aliceAddress, repayFunds.sub(ethers.utils.parseEther("1")));
            const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
            stages["aliceRepay"] = [await timeHelpers.latestTimestamp()];

            totalDebtValue = totalDebtValue.add(
              calculateAccruedInterest(
                stages["aliceDeposit"][0],
                stages["aliceRepay"][0],
                totalDebtValue,
                INTEREST_PER_SECOND
              )
            );

            expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(
              repayFunds.sub(ethers.utils.parseEther("1"))
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
            expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
            expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
            expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
            expect(
              await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress))
            ).to.be.eq(totalDebtValue.sub(repayFunds.sub(ethers.utils.parseEther("1"))));
          });
        });
      });
    });

    context("when Bob repay for Alice account", async () => {
      const bobCollateralAmount = ethers.utils.parseEther("10000000");
      const bobBorrowAmount = bobCollateralAmount.div(2);

      beforeEach(async () => {
        // Bob deposit and borrow FLAT
        const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
        const totalDebtShareBefore = await usdcUsdtLpMarket.totalDebtShare();
        await usdcUsdtLpMarketAsBob.depositAndBorrow(
          bobAddress,
          bobCollateralAmount,
          bobBorrowAmount,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        );
        const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);
        stages["bobDepositAndBorrow"] = [await timeHelpers.latestTimestamp()];

        const accruedInterest = calculateAccruedInterest(
          stages["aliceDeposit"][0],
          stages["bobDepositAndBorrow"][0],
          totalDebtValue,
          INTEREST_PER_SECOND
        );
        totalDebtValue = totalDebtValue.add(accruedInterest);

        const expectedBobDebtShare = debtHelpers.debtValueToShare(
          bobBorrowAmount,
          totalDebtShareBefore,
          totalDebtValue
        );

        const expectedTotalCollateral = collateralAmount.add(bobCollateralAmount);
        expect(bobUsdcUsdtLpBefore.sub(bobUsdcUsdtLpAfter)).to.be.eq(bobCollateralAmount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(bobCollateralAmount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(expectedTotalCollateral);
        expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(expectedTotalCollateral);
        expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
        expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
        expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(borrowAmount);
        expect(await usdcUsdtLpMarket.userDebtShare(bobAddress)).to.be.eq(expectedBobDebtShare);
        expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(borrowAmount.add(expectedBobDebtShare));
        expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue.add(bobBorrowAmount));

        // Update totalDebtShare
        totalDebtShare = totalDebtShare.add(expectedBobDebtShare);
        totalDebtValue = totalDebtValue.add(bobBorrowAmount);

        await usdcUsdtLpMarketAsBob.deposit(flat.address, bobAddress, bobBorrowAmount);
        stages["bobDeposit"] = [await timeHelpers.latestTimestamp()];

        totalDebtValue = totalDebtValue.add(
          calculateAccruedInterest(
            stages["bobDepositAndBorrow"][0],
            stages["bobDeposit"][0],
            totalDebtValue,
            INTEREST_PER_SECOND
          )
        );

        expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
      });

      context("when he repay all borrowed FLAT (exclude interest)", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsBob.repay(aliceAddress, repayFunds);
          const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          stages["bobRepay"] = [await timeHelpers.latestTimestamp()];

          totalDebtValue = totalDebtValue.add(
            calculateAccruedInterest(
              stages["bobDeposit"][0],
              stages["bobRepay"][0],
              totalDebtValue,
              INTEREST_PER_SECOND
            )
          );

          // Calculate Alice's debtValue, Alice's debtShare is equal to her borrowAmount
          const expectedDebtShareToDeduct = debtHelpers.debtValueToShare(repayFunds, totalDebtShare, totalDebtValue);
          const expectedAliceDebtShare = borrowAmount.sub(expectedDebtShareToDeduct);
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(
            expectedAliceDebtShare,
            totalDebtShare.sub(expectedDebtShareToDeduct),
            totalDebtValue.sub(repayFunds)
          );

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.add(bobCollateralAmount));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(expectedAliceDebtShare);
          expect(await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress))).to.be.eq(
            expectedAliceDebtValue
          );
        });
      });

      context("when he repay all borrowed FLAT (interest included)", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsBob.repay(aliceAddress, ethers.constants.MaxUint256);
          const usdcUsdtLpMarketFlatAfter = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          stages["bobRepay"] = [await timeHelpers.latestTimestamp()];

          totalDebtValue = totalDebtValue.add(
            calculateAccruedInterest(
              stages["bobDeposit"][0],
              stages["bobRepay"][0],
              totalDebtValue,
              INTEREST_PER_SECOND
            )
          );

          // Calculate Alice's debtValue, Alice's debtShare is equal to her borrowAmount
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(borrowAmount, totalDebtShare, totalDebtValue);

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(expectedAliceDebtValue);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.add(bobCollateralAmount));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(0);
        });
      });
    });
  });

  describe("#withdraw", async () => {
    const collteralAmount = ethers.utils.parseEther("8888888");

    beforeEach(async () => {
      await usdcUsdtLpMarketAsAlice.deposit(usdcUsdtLp.address, aliceAddress, collteralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(collteralAmount);
    });

    context("when Alice withdraw more than what she has", async () => {
      it("should revert", async () => {
        await expect(usdcUsdtLpMarketAsAlice.withdraw(usdcUsdtLp.address, aliceAddress, collteralAmount.add(1))).to.be
          .reverted;
      });
    });

    context("when Alice withdraw to her account", async () => {
      it("should work", async () => {
        const aliceUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.withdraw(usdcUsdtLp.address, aliceAddress, collteralAmount);
        const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

        expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(collteralAmount);
        expect(await clerk.balanceOf(aliceAddress, usdcUsdtLp.address)).to.be.eq(0);
      });
    });

    context("when Alice withdraw to Bob account", async () => {
      it("should work", async () => {
        const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
        await usdcUsdtLpMarketAsAlice.withdraw(usdcUsdtLp.address, bobAddress, collteralAmount);
        const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

        expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(collteralAmount);
        expect(await clerk.balanceOf(bobAddress, usdcUsdtLp.address)).to.be.eq(0);
      });
    });
  });

  describe("#withdrawSurplus", async () => {
    context("when caller is not treasury", async () => {
      it("should revert", async () => {
        await expect(usdcUsdtLpMarketAsAlice.withdrawSurplus()).to.be.revertedWith("not treasury");
      });
    });
  });
});
