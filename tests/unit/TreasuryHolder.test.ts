import { waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { treasuryHolderUnitTestFixture } from "../helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet } from "@ethersproject/wallet";
import { Clerk, FLAT, SimpleToken, TreasuryHolder } from "../../typechain/v8";
import { BaseContract, constants } from "ethers";
import { FakeContract, MockContract } from "@defi-wonderland/smock";
import { MockWBNB } from "@latteswap/latteswap-contract/compiled-typechain";
import { MockFlatMarketForTreasuryHolder } from "../../typechain/v8";
import { parseEther } from "ethers/lib/utils";

chai.use(solidity);
const { expect } = chai;

function fromMockContract<T extends BaseContract>(mock: MockContract<T>): T {
  return mock as unknown as T;
}

describe("TreasuryHolder", () => {
  // Contract bindings
  let deployer: SignerWithAddress;
  let alice: Wallet;
  let bob: Wallet;
  let carol: SignerWithAddress;
  let wbnb: MockWBNB;
  let clerk: MockContract<Clerk>;
  let stakingToken: SimpleToken;
  let flat: FLAT;
  let flatMarkets: Array<MockContract<MockFlatMarketForTreasuryHolder>>;
  let treasuryHolder: TreasuryHolder;
  let flatMarketConfig: FakeContract<BaseContract>;
  let compositeOracle: FakeContract<BaseContract>;

  beforeEach(async () => {
    ({
      deployer,
      alice,
      bob,
      carol,
      wbnb,
      clerk,
      stakingToken,
      flat,
      treasuryHolder,
      flatMarkets,
      compositeOracle,
      flatMarketConfig,
    } = await waffle.loadFixture(treasuryHolderUnitTestFixture));
  });

  describe("#settleBadDebt()", () => {
    context("when the market is not in a bad debt condition", () => {
      it("should revert", async () => {
        await expect(treasuryHolder.settleBadDebt([constants.AddressZero])).to.be.revertedWith(
          "TreasuryHolder::settleBadDebt:: market is not in bad debt"
        );
      });
    });

    context("when the market is in a bad debt condition", () => {
      context("single market having bad debt", () => {
        it("should be able to change a bad debt market boolean and the count", async () => {
          // mock onBadDebt to be a deployer
          await clerk.whitelistMarket(flatMarkets[0].address, true);
          await fromMockContract<MockFlatMarketForTreasuryHolder>(flatMarkets[0]).mockOnBadDebtCall(parseEther("168"));

          expect(await treasuryHolder.totalBadDebtValue()).to.eq(parseEther("168"));
          expect(await treasuryHolder.badDebtMarkets(flatMarkets[0].address)).to.eq(parseEther("168"));
          // mock as if treasury holder have the fee in the pocket
          await flat.approve(clerk.address, parseEther("1000"));
          await (clerk as unknown as Clerk).deposit(
            flat.address,
            await deployer.getAddress(),
            treasuryHolder.address,
            parseEther("1000"),
            0
          );
          await expect(treasuryHolder.settleBadDebt([flatMarkets[0].address]))
            .to.emit(treasuryHolder, "LogBadDebt")
            .withArgs(flatMarkets[0].address, parseEther("168"));
          expect(await fromMockContract<Clerk>(clerk).balanceOf(flat.address, flatMarkets[0].address)).to.eq(
            parseEther("168")
          );
        });
      });

      context("multiple markets having bad debt", () => {
        it("should be able to change a bad debt market boolean and the count", async () => {
          // mock onBadDebt to be a deployer
          await clerk.whitelistMarket(flatMarkets[0].address, true);
          await clerk.whitelistMarket(flatMarkets[1].address, true);
          await fromMockContract<MockFlatMarketForTreasuryHolder>(flatMarkets[0]).mockOnBadDebtCall(parseEther("168"));
          await fromMockContract<MockFlatMarketForTreasuryHolder>(flatMarkets[1]).mockOnBadDebtCall(parseEther("168"));
          // mock as if treasury holder have the fee in the pocket
          await flat.approve(clerk.address, parseEther("1000"));
          await (clerk as unknown as Clerk).deposit(
            flat.address,
            await deployer.getAddress(),
            treasuryHolder.address,
            parseEther("1000"),
            0
          );

          await expect(treasuryHolder.settleBadDebt([flatMarkets[0].address, flatMarkets[1].address]))
            .to.emit(treasuryHolder, "LogBadDebt")
            .withArgs(flatMarkets[0].address, parseEther("168"))
            .to.emit(treasuryHolder, "LogBadDebt")
            .withArgs(flatMarkets[1].address, parseEther("168"));
          expect(await fromMockContract<Clerk>(clerk).balanceOf(flat.address, flatMarkets[0].address)).to.eq(
            parseEther("168")
          );
          expect(await fromMockContract<Clerk>(clerk).balanceOf(flat.address, flatMarkets[1].address)).to.eq(
            parseEther("168")
          );
        });
      });
    });
  });

  describe("#withdrawSurplus()", () => {
    context("if there is a bad debt", () => {
      it("should revert", async () => {
        await clerk.whitelistMarket(flatMarkets[0].address, true);
        await fromMockContract<MockFlatMarketForTreasuryHolder>(flatMarkets[0]).mockOnBadDebtCall(parseEther("1"));

        await expect(treasuryHolder.withdrawSurplus()).to.be.revertedWith(
          "TreasuryHolder::withdrawSurplus:: there are still bad debt markets"
        );
      });
    });

    context("if treasury EOA is address(0)", () => {
      it("should revert", async () => {
        await treasuryHolder.setTreasuryEOA(constants.AddressZero);
        await expect(treasuryHolder.withdrawSurplus()).to.be.revertedWith(
          "TreasuryHolder::withdrawSurplus:: treasuryEOA is address(0)"
        );
      });
    });

    it("should be able to withdraw reserve", async () => {
      await clerk.whitelistMarket(flatMarkets[0].address, true);
      // mock as if treasury holder have the fee in the pocket
      await flat.approve(clerk.address, parseEther("1000"));
      await (clerk as unknown as Clerk).deposit(
        flat.address,
        await deployer.getAddress(),
        treasuryHolder.address,
        parseEther("1000"),
        0
      );

      await expect(treasuryHolder.withdrawSurplus())
        .to.emit(treasuryHolder, "LogWithdrawSurplus")
        .withArgs(alice.address, parseEther("1000"));

      expect(await flat.balanceOf(alice.address)).to.eq(parseEther("1000"));
    });
  });

  describe("#collectSurplus()", () => {
    it("should able to collect a surplus from FlatMarket", async () => {
      // mock onBadDebt to be a deployer
      await clerk.whitelistMarket(flatMarkets[0].address, true);

      // mock as if treasury holder have the fee in the pocket
      await flat.approve(clerk.address, parseEther("1000"));
      await (clerk as unknown as Clerk).deposit(
        flat.address,
        await deployer.getAddress(),
        flatMarkets[0].address,
        parseEther("1000"),
        0
      );

      // mock flat market variables
      await flatMarkets[0].setVariable("surplus", parseEther("168").toString());

      await flatMarkets[0].setVariable("liquidationFee", parseEther("569").toString());
      await expect(treasuryHolder.collectSurplus([flatMarkets[0].address]))
        .to.emit(flatMarkets[0], "LogWithdrawSurplus")
        .withArgs(treasuryHolder.address, parseEther("168"))
        .to.emit(flatMarkets[0], "LogWithdrawLiquidationFee")
        .withArgs(treasuryHolder.address, parseEther("569"));
      expect(await clerk.balanceOf(flat.address, treasuryHolder.address)).to.eq(
        parseEther("168").add(parseEther("569"))
      );
    });
  });
});
