import { ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Signer, constants, BigNumberish } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import {
  Clerk,
  Clerk__factory,
  CompositeOracle,
  CompositeOracle__factory,
  FLAT,
  FlatMarket,
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
  const MAX_COLLATERAL_RATIO = "85000";
  const INTEREST_PER_SECONDS = ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60);

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

  // contract account
  let flatAsAlice: FLAT;
  let usdcUsdtLpAsAlice: SimpleToken;
  let usdcUsdtLpMarketAsAlice: FlatMarket;

  let flatAsBob: FLAT;
  let usdcUsdtLpAsBob: SimpleToken;
  let usdcUsdtLpMarketAsBob: FlatMarket;

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
    flat = await FLAT.deploy();

    // Deploy usdcUsdtLpMarket
    // Assuming 0.5% interest rate per year
    // Assuming 85% collateralization ratio
    const FlatMarket = (await ethers.getContractFactory("FlatMarket", deployer)) as FlatMarket__factory;
    usdcUsdtLpMarket = (await upgrades.deployProxy(FlatMarket, [
      clerk.address,
      flat.address,
      usdcUsdtLp.address,
      compositOracle.address,
      ethers.utils.defaultAbiCoder.encode(["address"], [usdcUsdtLp.address]),
      INTEREST_PER_SECONDS,
      "105000",
      MAX_COLLATERAL_RATIO,
      deployerAddress,
    ])) as FlatMarket;

    // Whitelist market to allow market to access funds in Clerk
    await clerk.whitelistMarket(usdcUsdtLpMarket.address, true);

    // Mint FLAT to usdcUsdtLpMarket
    await flat.mintToClerk(usdcUsdtLpMarket.address, ethers.utils.parseEther("168168168168168"), clerk.address);

    // Connect contracts to Alice
    usdcUsdtLpAsAlice = SimpleToken__factory.connect(usdcUsdtLp.address, alice);
    usdcUsdtLpMarketAsAlice = FlatMarket__factory.connect(usdcUsdtLpMarket.address, alice);
    flatAsAlice = FLAT__factory.connect(flat.address, alice);

    // Conenct contracts to Bob
    usdcUsdtLpAsBob = SimpleToken__factory.connect(usdcUsdtLp.address, bob);
    usdcUsdtLpMarketAsBob = FlatMarket__factory.connect(usdcUsdtLpMarket.address, bob);
    flatAsBob = FLAT__factory.connect(flat.address, bob);

    // Transfer usdcUsdtLp to Alice and Bob
    await usdcUsdtLp.transfer(aliceAddress, ethers.utils.parseEther("100000000"));
    await usdcUsdtLp.transfer(bobAddress, ethers.utils.parseEther("100000000"));
    // Approve clerk to deduct money
    await usdcUsdtLpAsAlice.approve(clerk.address, ethers.constants.MaxUint256);
    await usdcUsdtLpAsBob.approve(clerk.address, ethers.constants.MaxUint256);
    // Approve clerk to deduct money
    await flatAsAlice.approve(clerk.address, ethers.constants.MaxUint256);
    await flatAsBob.approve(clerk.address, ethers.constants.MaxUint256);
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
      expect(await usdcUsdtLpMarket.interestPerSecond()).to.equal(
        ethers.utils.parseEther("0.005").div(365 * 24 * 60 * 60)
      );
      expect(await usdcUsdtLpMarket.maxCollateralRatio()).to.equal("85000");
      expect(await usdcUsdtLpMarket.liquidationMultiplier()).to.equal("105000");
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
      const expectedSurplus = borrowAmount.mul(timePast).mul(INTEREST_PER_SECONDS).div(ethers.constants.WeiPerEther);
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
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(100000).add(1);

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
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(100000);

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
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(100000).add(1);

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
          const borrowAmount = collateralAmount.mul(MAX_COLLATERAL_RATIO).div(100000);

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
        // This should revert due to maxCollateralRatio is 85% and collateral is only 10,000,000.
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
              INTEREST_PER_SECONDS
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
          INTEREST_PER_SECONDS
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
              INTEREST_PER_SECONDS
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
              INTEREST_PER_SECONDS
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
      context("when '_to' is her account", async () => {
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

      context("when '_to' is Bob account", async () => {
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
      const aliceMinCollateral = borrowAmount.mul(100000).div(MAX_COLLATERAL_RATIO);
      const canRemoveCollateral = collateralAmount.sub(aliceMinCollateral);

      beforeEach(async () => {
        // Turn off interest before borrow
        await usdcUsdtLpMarket.setInterestPerSecond(0);

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

      context("when '_to' is her account", async () => {
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
          context(
            "when her position went over MAX_COLLATERAL_RATIO after she does depositRepayAndWithdraw",
            async () => {
              it("should revert", async () => {
                await expect(
                  usdcUsdtLpMarketAsAlice.depositRepayAndWithdraw(
                    aliceAddress,
                    "1",
                    canRemoveCollateral.sub(1),
                    ethers.utils.parseEther("1"),
                    ethers.utils.parseEther("1")
                  )
                ).to.be.revertedWith("!safe");
              });
            }
          );
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
      const aliceMinCollateral = borrowAmount.mul(100000).div(MAX_COLLATERAL_RATIO);
      const canRemoveCollateral = collateralAmount.sub(aliceMinCollateral);

      beforeEach(async () => {
        // Turn off interest before borrow
        await usdcUsdtLpMarket.setInterestPerSecond(0);

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
          INTEREST_PER_SECONDS
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
              INTEREST_PER_SECONDS
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
          INTEREST_PER_SECONDS
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
            INTEREST_PER_SECONDS
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
              INTEREST_PER_SECONDS
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
              INTEREST_PER_SECONDS
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
});
