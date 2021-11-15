import { ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Signer, BigNumberish } from "ethers";
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
  OffChainOracle,
  OffChainOracle__factory,
  SimpleToken,
  SimpleToken__factory,
} from "../../typechain/v8";
import {
  LatteSwapFactory,
  LatteSwapFactory__factory,
  LatteSwapRouter,
  LatteSwapRouter__factory,
  MockWBNB,
  MockWBNB__factory,
} from "../../typechain/v6";
import { FOREVER, MAX_PRICE_DEVIATION } from "../helpers/constants";
import * as timeHelpers from "../helpers/time";
import * as debtHelpers from "../helpers/debt";

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
    compositOracle = (await upgrades.deployProxy(CompositeOracle, [])) as CompositeOracle;
    await compositOracle.setPrimarySources(
      usdcUsdtLp.address,
      MAX_PRICE_DEVIATION,
      [offChainOracle.address],
      [ethers.utils.defaultAbiCoder.encode(["address", "address"], [usdcUsdtLp.address, usdt.address])]
    );

    // Expect composit oracle can query from offchain oracle
    [updated, price] = await compositOracle.get(ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address]));
    expect(updated).to.be.true;
    expect(price).to.eq(ethers.utils.parseEther("1"));

    // Deploy Clerk
    const Clerk = (await ethers.getContractFactory("Clerk", deployer)) as Clerk__factory;
    clerk = (await upgrades.deployProxy(Clerk, [wbnb.address])) as Clerk;

    // Deploy FLAT
    const FLAT = (await ethers.getContractFactory("FLAT", deployer)) as FLAT__factory;
    flat = await FLAT.deploy(DAY, MAX_MINT_BPS);

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
      await usdcUsdtLpMarket.withdrawRevenue();
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

        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
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

      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
    context("when msg.sender and '_to' is the same person", async () => {
      it("should take token from msg.sender and credit msg.sender", async () => {
        const amount = ethers.utils.parseEther("10000000");
        const aliceBefore = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);
        await usdcUsdtLpMarketAsAlice.depositAndAddCollateral(aliceAddress, amount);
        const aliceAfter = await usdcUsdtLpAsAlice.balanceOf(aliceAddress);

        expect(aliceBefore.sub(aliceAfter)).to.be.eq(amount);
        expect(await usdcUsdtLp.balanceOf(clerk.address)).to.be.eq(amount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(amount);
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
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(amount);
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
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsAlice.depositAndRepay(
            aliceAddress,
            repayFunds,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
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

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(
            await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress), true)
          ).to.be.eq(totalDebtValue.sub(repayFunds));
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
          totalDebtValue,
          true
        );

        const expectedTotalCollateral = collateralAmount.add(bobCollateralAmount);
        expect(bobUsdcUsdtLpBefore.sub(bobUsdcUsdtLpAfter)).to.be.eq(bobCollateralAmount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(expectedTotalCollateral);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
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
          await usdcUsdtLpMarketAsBob.depositAndRepay(
            aliceAddress,
            repayFunds,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
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
          const expectedDebtShareToDeduct = debtHelpers.debtValueToShare(
            repayFunds,
            totalDebtShare,
            totalDebtValue,
            false
          );
          const expectedAliceDebtShare = borrowAmount.sub(expectedDebtShareToDeduct);
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(
            expectedAliceDebtShare,
            totalDebtShare.sub(expectedDebtShareToDeduct),
            totalDebtValue.sub(repayFunds),
            true
          );

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
            collateralAmount.add(bobCollateralAmount)
          );
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.add(bobCollateralAmount));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(expectedAliceDebtShare);
          expect(
            await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress), true)
          ).to.be.eq(expectedAliceDebtValue);
        });
      });

      context("when he repay all borrowed FLAT + interest", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsBob.depositAndRepay(
            aliceAddress,
            ethers.constants.MaxUint256,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
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
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(
            borrowAmount,
            totalDebtShare,
            totalDebtValue,
            true
          );

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(expectedAliceDebtValue);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
            collateralAmount.add(bobCollateralAmount)
          );
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
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
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
                aliceAddress,
                "0",
                removeCollateral,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
              const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

              expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
                aliceAddress,
                "0",
                removeCollateral,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
              const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);

              expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
              expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
                collateralAmount.sub(removeCollateral)
              );
              expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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

        context("when Alice '_for' is Bob & '_to' is Alice", async () => {
          context("when she not return any debt for Bob", async () => {
            context(
              "when her position went over MAX_COLLATERAL_RATIO after she does depositRepayAndWithdraw",
              async () => {
                it("should revert", async () => {
                  await expect(
                    usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                      bobAddress,
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
                const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
                await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                  bobAddress,
                  aliceAddress,
                  "0",
                  removeCollateral,
                  ethers.utils.parseEther("1"),
                  ethers.utils.parseEther("1")
                );
                const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);
                const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);

                expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
                expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(0);
                expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
                  collateralAmount.mul(2).sub(removeCollateral)
                );
                expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
                expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(
                  collateralAmount.mul(2).sub(removeCollateral)
                );
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
                const bobUsdcUsdtLpBefore = await usdcUsdtLp.balanceOf(bobAddress);
                const bobDebtShareBefore = await usdcUsdtLpMarket.userDebtShare(bobAddress);
                await usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                  bobAddress,
                  aliceAddress,
                  returnAmount,
                  removeCollateral,
                  ethers.utils.parseEther("1"),
                  ethers.utils.parseEther("1")
                );
                const aliceUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(aliceAddress);
                const bobUsdcUsdtLpAfter = await usdcUsdtLp.balanceOf(bobAddress);
                const bobDebtShareAfter = await usdcUsdtLpMarket.userDebtShare(bobAddress);

                expect(bobDebtShareAfter).to.be.lt(bobDebtShareBefore);
                expect(aliceUsdcUsdtLpAfter.sub(aliceUsdcUsdtLpBefore)).to.be.eq(removeCollateral);
                expect(bobUsdcUsdtLpAfter.sub(bobUsdcUsdtLpBefore)).to.be.eq(0);
                expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
                  collateralAmount.mul(2).sub(removeCollateral)
                );
                expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
                expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(
                  collateralAmount.mul(2).sub(removeCollateral)
                );
                expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(
                  collateralAmount.sub(removeCollateral)
                );
              });
            });
          });
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
    let totalDebtShare = ethers.BigNumber.from(0);
    let totalDebtValue = ethers.BigNumber.from(0);

    beforeEach(async () => {
      // Reset variables
      totalDebtShare = ethers.BigNumber.from(0);
      totalDebtValue = ethers.BigNumber.from(0);

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
      totalDebtValue = totalDebtValue.add(
        calculateAccruedInterest(
          stages["aliceDepositAndBorrow"],
          stages["bobDepositAndBorrow"],
          totalDebtValue,
          INTEREST_PER_SECOND
        )
      );
      // Calculate totalDebtShare when debt is added to Bob
      totalDebtShare = totalDebtShare.add(
        debtHelpers.debtValueToShare(bobBorrowAmount, totalDebtShare, totalDebtValue, true)
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
          totalDebtValue = totalDebtValue.add(
            calculateAccruedInterest(
              stages["bobDepositAndBorrow"],
              stages["catDeposit"],
              totalDebtValue,
              INTEREST_PER_SECOND
            )
          );

          expect(catFlatAfter.sub(catFlatBefore)).to.be.eq(ethers.utils.parseEther("10000000"));
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
        });

        context("when liquidator try to kill both Bob and Alice", async () => {
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
            totalDebtValue = totalDebtValue.add(
              calculateAccruedInterest(stages["catDeposit"], stages["catKill"], totalDebtValue, INTEREST_PER_SECOND)
            );
            // Calculate Bob's debt value to be removed
            const bobDebtValue = debtHelpers.debtShareToValue(
              bobDebtShareBefore,
              totalDebtShare,
              totalDebtValue,
              false
            );
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
            expect(catFlatBefore.sub(catFlatAfter)).to.be.eq(bobDebtValue.add(liquidationFee));
          });
        });
      });

      context("when Bob's position is bad debt", async () => {
        const collateralPrice = ethers.utils.parseEther("0.75");

        beforeEach(async () => {
          // Set Oracle price to USDC-USDT LP to 0.75 so that Bob position is bad debt
          await offChainOracle.setPrices([usdcUsdtLp.address], [usdt.address], [collateralPrice]);

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
          totalDebtValue = totalDebtValue.add(
            calculateAccruedInterest(
              stages["bobDepositAndBorrow"],
              stages["catDeposit"],
              totalDebtValue,
              INTEREST_PER_SECOND
            )
          );

          expect(catFlatAfter.sub(catFlatBefore)).to.be.eq(ethers.utils.parseEther("10000000"));
          expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
          expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);
        });

        context("when liquidator try to kill both Bob and Alice", async () => {
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
            totalDebtValue = totalDebtValue.add(
              calculateAccruedInterest(stages["catDeposit"], stages["catKill"], totalDebtValue, INTEREST_PER_SECOND)
            );
            // Calculate expected debtShare to be taken from Bob
            const bobTakenDebtValue = bobCollateralAmount
              .mul(collateralPrice)
              .mul(ethers.BigNumber.from(2e4).sub(LIQUIDATION_PENALTY))
              .div(ethers.constants.WeiPerEther.mul(1e4));
            const bobTakenDebtShare = debtHelpers.debtValueToShare(
              bobTakenDebtValue,
              totalDebtShare,
              totalDebtValue,
              true
            );
            // Calculate totalDebtShare when debt is removed from Bob
            totalDebtShare = totalDebtShare.sub(bobTakenDebtShare);
            // Calculate totalDebtValue after Bob's position is killed
            totalDebtValue = totalDebtValue.sub(bobTakenDebtValue);
            // Expect that totalDebtValue and totalDebtShare must correct
            expect(await usdcUsdtLpMarket.totalDebtShare()).to.be.eq(totalDebtShare);
            expect(await usdcUsdtLpMarket.totalDebtValue()).to.be.eq(totalDebtValue);

            expect(aliceDebtShareAfter).to.be.eq(aliceDebtShareBefore);
            expect(aliceCollateralBefore).to.be.eq(aliceCollateralAfter);
            expect(bobDebtShareAfter).to.be.eq(0);
            expect(bobCollateralAfter).to.be.eq(0);
            expect(await usdcUsdtLpMarket.userDebtShare(deployerAddress)).to.be.eq(
              bobDebtShareBefore.sub(bobTakenDebtShare)
            );
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
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(removeCollateral);
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
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
            expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
              collateralAmount.sub(removeCollateral)
            );
            expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
      expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
      expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
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
          await expect(
            usdcUsdtLpMarketAsAlice.repay(
              aliceAddress,
              repayFunds.add(1),
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            )
          ).to.be.reverted;
        });
      });

      context("when she repay all borrowed FLAT", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsAlice.repay(
            aliceAddress,
            repayFunds,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
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

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(collateralAmount);
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(
            await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress), true)
          ).to.be.eq(totalDebtValue.sub(repayFunds));
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
          totalDebtValue,
          true
        );

        const expectedTotalCollateral = collateralAmount.add(bobCollateralAmount);
        expect(bobUsdcUsdtLpBefore.sub(bobUsdcUsdtLpAfter)).to.be.eq(bobCollateralAmount);
        expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(expectedTotalCollateral);
        expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
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
          await usdcUsdtLpMarketAsBob.repay(
            aliceAddress,
            repayFunds,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
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
          const expectedDebtShareToDeduct = debtHelpers.debtValueToShare(
            repayFunds,
            totalDebtShare,
            totalDebtValue,
            false
          );
          const expectedAliceDebtShare = borrowAmount.sub(expectedDebtShareToDeduct);
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(
            expectedAliceDebtShare,
            totalDebtShare.sub(expectedDebtShareToDeduct),
            totalDebtValue.sub(repayFunds),
            true
          );

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(repayFunds);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
            collateralAmount.add(bobCollateralAmount)
          );
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
          expect(await usdcUsdtLpMarket.totalCollateralShare()).to.be.eq(collateralAmount.add(bobCollateralAmount));
          expect(await usdcUsdtLpMarket.userCollateralShare(aliceAddress)).to.be.eq(collateralAmount);
          expect(await usdcUsdtLpMarket.userCollateralShare(bobAddress)).to.be.eq(bobCollateralAmount);
          expect(await usdcUsdtLpMarket.userDebtShare(aliceAddress)).to.be.eq(expectedAliceDebtShare);
          expect(
            await usdcUsdtLpMarket.debtShareToValue(await usdcUsdtLpMarket.userDebtShare(aliceAddress), true)
          ).to.be.eq(expectedAliceDebtValue);
        });
      });

      context("when he repay all borrowed FLAT (interest included)", async () => {
        it("should have some interest left", async () => {
          const usdcUsdtLpMarketFlatBefore = await clerk.balanceOf(flat.address, usdcUsdtLpMarket.address);
          await usdcUsdtLpMarketAsBob.repay(
            aliceAddress,
            ethers.constants.MaxUint256,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("1")
          );
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
          const expectedAliceDebtValue = debtHelpers.debtShareToValue(
            borrowAmount,
            totalDebtShare,
            totalDebtValue,
            true
          );

          expect(usdcUsdtLpMarketFlatAfter.sub(usdcUsdtLpMarketFlatBefore)).to.be.eq(expectedAliceDebtValue);
          expect(await clerk.balanceOf(usdcUsdtLp.address, usdcUsdtLpMarket.address)).to.be.eq(
            collateralAmount.add(bobCollateralAmount)
          );
          expect(await clerk.balanceOf(usdcUsdtLp.address, aliceAddress)).to.be.eq(0);
          expect(await clerk.balanceOf(usdcUsdtLp.address, bobAddress)).to.be.eq(0);
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
});
