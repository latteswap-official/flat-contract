import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { clerkUnitTestFixture } from "../helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet } from "@ethersproject/wallet";
import {
  Clerk,
  Clerk__factory,
  MockEvilFlashLoaner,
  MockFlashLoaner,
  SimpleToken,
  SimpleToken__factory,
} from "../../typechain/v8";
import { BigNumber, constants } from "ethers";
import { MockContract } from "@defi-wonderland/smock";
import { MockWBNB } from "@latteswap/latteswap-contract/compiled-typechain";
import { duration, increaseTimestamp } from "../helpers/time";

chai.use(solidity);
const { expect } = chai;

describe("Clerk", () => {
  // Contract bindings
  let deployer: SignerWithAddress;
  let alice: Wallet;
  let bob: Wallet;
  let carol: SignerWithAddress;
  let wbnb: MockWBNB;
  let clerk: MockContract<Clerk>;
  let stakingTokens: Array<SimpleToken>;

  const extremeValidVolume = BigNumber.from(2).pow(127);
  const vaultProtocolLimit = BigNumber.from(2).pow(128).sub(1);
  const computationalLimit = constants.MaxUint256.sub(1);

  // contract as a user
  let clerkAsAlice: Clerk;
  let stakingToken0AsAlice: SimpleToken;
  let flashloaner: MockFlashLoaner;
  let evilFlashloaner: MockEvilFlashLoaner;

  beforeEach(async () => {
    ({
      deployer,
      alice,
      bob,
      funder: carol,
      wbnb,
      clerk,
      stakingTokens,
      flashloaner,
      evilFlashloaner,
    } = await waffle.loadFixture(clerkUnitTestFixture));

    clerkAsAlice = Clerk__factory.connect(clerk.address, alice);
    stakingToken0AsAlice = SimpleToken__factory.connect(stakingTokens[0].address, alice);
  });

  describe("#toshare() - #toAmount() - Conversion", function () {
    it("Should convert Shares to Amounts", async function () {
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 1000, false)).to.be.equal(1000);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 1, false)).to.be.equal(1);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 0, false)).to.be.equal(0);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 1000, true)).to.be.equal(1000);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 1, true)).to.be.equal(1);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 0, true)).to.be.equal(0);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, extremeValidVolume.toString(), false)).to.be.equal(
        extremeValidVolume.toString()
      );
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, vaultProtocolLimit.toString(), false)).to.be.equal(
        vaultProtocolLimit.toString()
      );
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, computationalLimit.toString(), false)).to.be.equal(
        computationalLimit.toString()
      );
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, extremeValidVolume.toString(), true)).to.be.equal(
        extremeValidVolume.toString()
      );
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, vaultProtocolLimit.toString(), true)).to.be.equal(
        vaultProtocolLimit.toString()
      );
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, computationalLimit.toString(), true)).to.be.equal(
        computationalLimit.toString()
      );
    });

    it("Should convert amount to Shares", async function () {
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 1000, false)).to.be.equal(1000);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 1, false)).to.be.equal(1);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 0, false)).to.be.equal(0);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 1000, true)).to.be.equal(1000);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 1, true)).to.be.equal(1);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 0, true)).to.be.equal(0);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, extremeValidVolume.toString(), false)).to.be.equal(
        extremeValidVolume.toString()
      );
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, vaultProtocolLimit.toString(), false)).to.be.equal(
        vaultProtocolLimit.toString()
      );
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, computationalLimit.toString(), false)).to.be.equal(
        computationalLimit.toString()
      );
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, extremeValidVolume.toString(), true)).to.be.equal(
        extremeValidVolume.toString()
      );
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, vaultProtocolLimit.toString(), true)).to.be.equal(
        vaultProtocolLimit.toString()
      );
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, computationalLimit.toString(), true)).to.be.equal(
        computationalLimit.toString()
      );
    });

    it("Should convert at ratio", async function () {
      await stakingToken0AsAlice.approve(clerkAsAlice.address, BigNumber.from(1666));
      const depositTx = await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        BigNumber.from(1000),
        0
      );
      const totalToken = await (clerk as unknown as Clerk).totals(stakingTokens[0].address);
      await clerk.setVariable("_totals", {
        [stakingTokens[0].address]: {
          amount: totalToken.amount.add(BigNumber.from(666)),
          share: totalToken.share,
        },
      });
      await depositTx.wait();

      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 10000, false)).to.be.equal(16660);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 1, false)).to.be.equal(1);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 0, false)).to.be.equal(0);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 10000, true)).to.be.equal(16660);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 1, true)).to.be.equal(2);
      expect(await clerkAsAlice.toAmount(stakingTokens[0].address, 0, true)).to.be.equal(0);
      // 10000 * 1000 / 1666 = 6002.4096
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 10000, false)).to.be.equal(6002);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 10000, true)).to.be.equal(6003);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 1, false)).to.be.equal(0);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 1, true)).to.be.equal(1);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 0, false)).to.be.equal(0);
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, 0, true)).to.be.equal(0);

      expect(await clerkAsAlice.toShare(stakingTokens[0].address, extremeValidVolume.toString(), false)).to.be.equal(
        BigNumber.from(extremeValidVolume).mul(1000).div(1666).toString()
      );
      expect(await clerkAsAlice.toShare(stakingTokens[0].address, vaultProtocolLimit.toString(), false)).to.be.equal(
        BigNumber.from(vaultProtocolLimit).mul(1000).div(1666).toString()
      );
      await expect(clerkAsAlice.toShare(stakingTokens[0].address, computationalLimit.toString(), false)).to.be.reverted;
    });
  });

  describe("#approve()", function () {
    it("approval succeeds with extreme but valid amount", async function () {
      await expect(stakingToken0AsAlice.approve(clerkAsAlice.address, extremeValidVolume.toString()))
        .to.emit(stakingToken0AsAlice, "Approval")
        .withArgs(alice.address, clerkAsAlice.address, extremeValidVolume.toString());
    });

    it("approval succeeds with clerk protocol limit", async function () {
      await expect(stakingToken0AsAlice.approve(clerkAsAlice.address, vaultProtocolLimit.toString()))
        .to.emit(stakingToken0AsAlice, "Approval")
        .withArgs(alice.address, clerkAsAlice.address, vaultProtocolLimit.toString());
    });

    it("approval succeeds with computational limit", async function () {
      await expect(stakingToken0AsAlice.approve(clerkAsAlice.address, computationalLimit.toString()))
        .to.emit(stakingToken0AsAlice, "Approval")
        .withArgs(alice.address, clerkAsAlice.address, computationalLimit.toString());
    });
  });

  describe("#deposit()", function () {
    context("with _to as address zero", () => {
      it("Reverts with to address zero", async function () {
        await expect(
          clerkAsAlice.deposit(stakingTokens[0].address, alice.address, constants.AddressZero, 0, 0)
        ).to.be.revertedWith("Clerk::deposit:: to not set");
        await expect(clerkAsAlice.deposit(wbnb.address, alice.address, constants.AddressZero, 0, 0)).to.be.revertedWith(
          "Clerk::deposit:: to not set"
        );
      });
    });

    it("Reverts on deposit - extreme volume at computational limit", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, computationalLimit.toString());
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, computationalLimit.toString(), 0)
      ).to.be.reverted;
    });

    it("Reverts on deposit - extreme volume at vault protocol limit", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, vaultProtocolLimit.toString());
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, vaultProtocolLimit.toString(), 0)
      ).to.be.reverted;
    });

    it("Reverts on deposit - extreme volume, below vault protocol limit, but above available reserves", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, extremeValidVolume.toString());
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, extremeValidVolume.toString(), 0)
      ).to.be.reverted;
    });

    it("Reverts without approval", async function () {
      await stakingTokens[0].connect(bob).approve(clerk.address, 1000);
      await expect(clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, 1000, 0)).to.be
        .reverted;
      await expect(clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, 1000, 0)).to.be.reverted;
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, vaultProtocolLimit.toString(), 0)
      ).to.be.reverted;
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, computationalLimit.toString(), 0)
      ).to.be.reverted;
      await expect(clerk.connect(bob).deposit(stakingTokens[1].address, bob.address, bob.address, 1000, 0)).to.be
        .reverted;
      expect(await clerk.balanceOf(stakingTokens[0].address, alice.address)).to.be.equal(0);
    });

    context("when msg sender != _from", () => {
      it("Mutates balanceOf correctly by deducting value from _from", async function () {
        await clerk.whitelistMarket(bob.address, true);
        await stakingTokens[1].connect(alice).approve(clerkAsAlice.address, 1000);
        const balBefore = await stakingTokens[1].balanceOf(alice.address);
        await expect(
          clerk.connect(bob).deposit(stakingTokens[1].address, alice.address, alice.address, 1, 0)
        ).to.not.emit(stakingTokens[1], "Transfer");
        await expect(
          clerk.connect(bob).deposit(stakingTokens[1].address, alice.address, alice.address, 999, 0)
        ).to.not.emit(stakingTokens[1], "Transfer");

        await expect(
          clerk.connect(bob).deposit(stakingTokens[1].address, alice.address, alice.address, 0, 1000)
        ).to.emit(stakingTokens[1], "Transfer");

        const balAfter = await stakingTokens[1].balanceOf(alice.address);
        expect(balBefore.sub(balAfter)).to.eq(1000);

        await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 1300);

        await expect(clerk.connect(bob).deposit(stakingTokens[0].address, alice.address, alice.address, 1300, 0))
          .to.emit(stakingTokens[0], "Transfer")
          .withArgs(alice.address, clerkAsAlice.address, "1300")
          .to.emit(clerk, "LogDeposit")
          .withArgs(stakingTokens[0].address, alice.address, alice.address, "1300", "1300");
        expect(await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address)).to.be.equal(1300);
      });
    });

    context("when msg sender == _from", () => {
      it("Mutates balanceOf correctly by deducting value from _from", async function () {
        await clerk.whitelistMarket(bob.address, true);
        await stakingTokens[1].connect(alice).approve(clerkAsAlice.address, 1000);
        const balBefore = await stakingTokens[1].balanceOf(alice.address);
        await expect(clerkAsAlice.deposit(stakingTokens[1].address, alice.address, alice.address, 1, 0)).to.not.emit(
          stakingTokens[1],
          "Transfer"
        );
        await expect(clerkAsAlice.deposit(stakingTokens[1].address, alice.address, alice.address, 999, 0)).to.not.emit(
          stakingTokens[1],
          "Transfer"
        );

        await expect(clerkAsAlice.deposit(stakingTokens[1].address, alice.address, alice.address, 0, 1000)).to.emit(
          stakingTokens[1],
          "Transfer"
        );

        const balAfter = await stakingTokens[1].balanceOf(alice.address);
        expect(balBefore.sub(balAfter)).to.eq(1000);

        await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 1300);

        await expect(clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, 1300, 0))
          .to.emit(stakingTokens[0], "Transfer")
          .withArgs(alice.address, clerkAsAlice.address, "1300")
          .to.emit(clerk, "LogDeposit")
          .withArgs(stakingTokens[0].address, alice.address, alice.address, "1300", "1300");
        expect(await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address)).to.be.equal(1300);
      });
    });

    it("Mutates balanceOf for Clerk and WBNB correctly", async function () {
      await wbnb.connect(alice).deposit({ value: ethers.utils.parseEther("1") });
      await expect(
        clerk.connect(bob).deposit(wbnb.address, bob.address, bob.address, 1, 0, {
          value: 1,
        })
      ).to.not.emit(wbnb, "Deposit");
      await expect(
        clerk.connect(bob).deposit(wbnb.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0, {
          value: ethers.utils.parseEther("1"),
        })
      )
        .to.emit(wbnb, "Deposit")
        .withArgs(clerkAsAlice.address, ethers.utils.parseEther("1"))
        .to.emit(clerk, "LogDeposit")
        .withArgs(wbnb.address, bob.address, bob.address, ethers.utils.parseEther("1"), ethers.utils.parseEther("1"));

      expect(await wbnb.balanceOf(clerkAsAlice.address), "Clerk should hold WBNB").to.be.equal(
        ethers.utils.parseEther("1")
      );
      expect(await clerkAsAlice.balanceOf(wbnb.address, bob.address), "bob should have WBNB").to.be.equal(
        ethers.utils.parseEther("1")
      );
    });

    context("if totalSupply of token is Zero or the token is not a token", () => {
      it("should revert", async () => {
        await expect(clerkAsAlice.deposit(constants.AddressZero, alice.address, alice.address, 1, 0, { value: 1 })).to
          .be.reverted;
        await expect(clerkAsAlice.deposit(bob.address, alice.address, alice.address, 1, 0)).to.be.reverted;
      });
    });

    it("Mutates balanceOf and totalSupply for two deposits correctly", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1200"));
      await clerk.setVariable("_totals", {
        [stakingTokens[0].address]: {
          amount: ethers.utils.parseEther("1300"),
          share: ethers.utils.parseEther("1000"),
        },
      });
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, ethers.utils.parseEther("100"), 0),
        "it should calculate a correct share // 100 * 1000 / 1300 = 76.923"
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("100"))
        .to.emit(clerk, "LogDeposit")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          ethers.utils.parseEther("100"),
          "76923076923076923076"
        );
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, ethers.utils.parseEther("200"), 0),
        "share = 200 * 176923076923076923076 / 230000000000000000000 = 153.846153846153846153"
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("200"))
        .to.emit(clerk, "LogDeposit")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          ethers.utils.parseEther("200"),
          "153846153846153846153"
        );

      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address),
        "amount calculation should be 76923076923076923076 + 153846153846153846153 = 230769230769230769229"
      ).to.be.equal("230769230769230769229");

      expect(
        (await clerkAsAlice.totals(stakingTokens[0].address)).amount,
        "totalamount should be  // 1300 + 100 + 200 = 1600"
      ).to.be.equal(ethers.utils.parseEther("1600"));

      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, ethers.utils.parseEther("400"), 0),
        "share of this transaction is 400 * 1230.769230769230769229 / 1600 = 307.692307692307692307"
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("400"))
        .to.emit(clerk, "LogDeposit")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          bob.address,
          ethers.utils.parseEther("400"),
          "307692307692307692307"
        );

      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, ethers.utils.parseEther("500"), 0),
        "share of this transaction is 500 * 1538.461538461538461536 / 2000 = 384.615384615384615384"
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("500"))
        .to.emit(clerk, "LogDeposit")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          bob.address,
          ethers.utils.parseEther("500"),
          "384615384615384615384"
        );

      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, bob.address),
        "bob's share should be 384615384615384615384 + 307692307692307692307"
      ).to.be.equal("692307692307692307691");

      expect((await clerkAsAlice.totals(stakingTokens[0].address)).amount, "total deposit is 2500").to.be.equal(
        ethers.utils.parseEther("2500")
      );
    });

    it("Emits LogDeposit event with correct arguments", async function () {
      await clerk.setVariable("_totals", {
        [stakingTokens[0].address]: {
          amount: ethers.utils.parseEther("1000"),
          share: ethers.utils.parseEther("76"),
        },
      });
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 1000);

      await expect(clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, 1000, 0))
        .to.emit(clerk, "LogDeposit")
        .withArgs(stakingTokens[0].address, alice.address, bob.address, 1000, 76);
    });
  });

  describe("#deposit() - share", function () {
    it("allows for deposit of Share", async function () {
      await clerk.setVariable("_totals", {
        [stakingTokens[0].address]: {
          amount: ethers.utils.parseEther("4"),
          share: ethers.utils.parseEther("2"),
        },
      });
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 2);
      await expect(clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, 0, 1))
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, "2")
        .to.emit(clerk, "LogDeposit")
        .withArgs(stakingTokens[0].address, alice.address, alice.address, "2", "1");
      expect(await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address)).to.be.equal(1);
    });

    context("with deposit of share", () => {
      it("should not allow grieving attack", async function () {
        await stakingTokens[1].connect(alice).approve(clerk.address, 1000000000000);

        await clerkAsAlice.deposit(stakingTokens[1].address, alice.address, alice.address, 0, 1);

        await clerk.setVariable("_totals", {
          [stakingTokens[1].address]: {
            amount: "2",
            share: "1",
          },
        });

        let amount = 2;
        for (let i = 0; i < 20; i++) {
          await clerkAsAlice.deposit(stakingTokens[1].address, alice.address, alice.address, amount - 1, 0);
          amount += amount - 1;
        }

        const ratio = (await clerkAsAlice.totals(stakingTokens[1].address)).amount.div(
          await clerkAsAlice.balanceOf(stakingTokens[1].address, alice.address)
        );

        expect(ratio.toNumber()).to.be.lessThan(5);
      });
    });
  });

  describe("#deposit() -  To", function () {
    it("Mutates balanceOf and totalSupply correctly", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("100"));

      await clerk.setVariable("_totals", {
        [stakingTokens[0].address]: {
          amount: ethers.utils.parseEther("1300"),
          share: ethers.utils.parseEther("1000"),
        },
      });

      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, bob.address, ethers.utils.parseEther("100"), 0)
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, "100000000000000000000")
        .to.emit(clerk, "LogDeposit")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          bob.address,
          "100000000000000000000",
          "76923076923076923076"
        );

      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address),
        "incorrect amount calculation"
      ).to.be.equal(0);
      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, bob.address),
        "amount should be 100 * 1000/1300 = 76.923076923076923076"
      ).to.be.equal("76923076923076923076");

      expect(
        (await clerkAsAlice.totals(stakingTokens[0].address)).amount,
        "total amount should be 1300 + 100"
      ).to.be.equal(ethers.utils.parseEther("1400"));
    });
  });

  describe("#withdraw()", function () {
    context("when the address is zero", () => {
      it("should revert", async () => {
        await expect(
          clerkAsAlice.withdraw(stakingTokens[0].address, alice.address, constants.AddressZero, 1, 0)
        ).to.be.revertedWith("Clerk::withdraw:: to not set");
      });
    });

    context("when withdraw below 1000 shares (can cause tiny shares)", () => {
      it("should revert", async () => {
        await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 1000);

        await expect(clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, 0, 1000))
          .to.emit(stakingTokens[0], "Transfer")
          .withArgs(alice.address, clerkAsAlice.address, "1000")
          .to.emit(clerk, "LogDeposit")
          .withArgs(stakingTokens[0].address, alice.address, alice.address, "1000", "1000");

        await expect(
          clerkAsAlice.withdraw(stakingTokens[0].address, alice.address, alice.address, 0, 2)
        ).to.be.revertedWith("Clerk::withdraw:: cannot empty");
      });
    });

    context("when attempting to withdraw larger amount than available", () => {
      it("should revert", async () => {
        await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1"));

        await clerkAsAlice.deposit(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          ethers.utils.parseEther("1"),
          0
        );

        await expect(
          clerkAsAlice.withdraw(stakingTokens[0].address, alice.address, alice.address, ethers.utils.parseEther("2"), 0)
        ).to.be.reverted;
      });
    });

    context("when attempting to withdraw an amount at computational limit (where deposit was valid", () => {
      it("should revert", async function () {
        await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, computationalLimit.toString());
        await clerkAsAlice.deposit(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          ethers.utils.parseEther("1"),
          0
        );
        await expect(
          clerkAsAlice.withdraw(
            stakingTokens[0].address,
            alice.address,
            alice.address,
            computationalLimit.toString(),
            0
          )
        ).to.be.reverted;
      });
    });

    context("when attempting to withdraw an amount at clerk protocol limit", () => {
      it("should revert", async function () {
        await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, vaultProtocolLimit.toString());
        await clerkAsAlice.deposit(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          ethers.utils.parseEther("1"),
          0
        );
        await expect(
          clerkAsAlice.withdraw(
            stakingTokens[0].address,
            alice.address,
            alice.address,
            vaultProtocolLimit.toString(),
            0
          )
        ).to.be.reverted;
      });
    });

    it("Mutates balanceOf of Token and Clerk correctly", async function () {
      const startBal = await stakingTokens[0].balanceOf(alice.address);
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("130"));
      await stakingTokens[0].connect(bob).approve(clerkAsAlice.address, ethers.utils.parseEther("260"));
      await clerk.setVariable("_totals", {
        [stakingTokens[0].address]: {
          amount: ethers.utils.parseEther("1300"),
          share: ethers.utils.parseEther("1000"),
        },
      });
      await expect(
        clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, ethers.utils.parseEther("130"), 0)
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(alice.address, clerkAsAlice.address, "130000000000000000000")
        .to.emit(clerk, "LogDeposit")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          "130000000000000000000",
          "100000000000000000000"
        );
      await expect(
        clerk
          .connect(bob)
          .deposit(stakingTokens[0].address, bob.address, bob.address, ethers.utils.parseEther("260"), 0)
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(bob.address, clerkAsAlice.address, "260000000000000000000")
        .to.emit(clerk, "LogDeposit")
        .withArgs(stakingTokens[0].address, bob.address, bob.address, "260000000000000000000", "200000000000000000000");
      await expect(
        clerkAsAlice.withdraw(stakingTokens[0].address, alice.address, alice.address, 0, ethers.utils.parseEther("100"))
      )
        .to.emit(stakingTokens[0], "Transfer")
        .withArgs(clerkAsAlice.address, alice.address, "130000000000000000000")
        .to.emit(clerk, "LogWithdraw")
        .withArgs(
          stakingTokens[0].address,
          alice.address,
          alice.address,
          "130000000000000000000",
          "100000000000000000000"
        );

      expect(await stakingTokens[0].balanceOf(alice.address), "alice should have all of their tokens back").to.equal(
        startBal
      );

      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address),
        "token should be withdrawn thus balance should be 0"
      ).to.equal(0);
    });

    it("Mutates balanceOf on Clerk for WBNB correctly", async function () {
      await wbnb.connect(alice).deposit({
        value: 1,
      });
      await clerk.connect(bob).deposit(wbnb.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0, {
        from: bob.address,
        value: ethers.utils.parseEther("1"),
      });
      await clerk
        .connect(bob)
        .withdraw(wbnb.address, bob.address, bob.address, ethers.utils.parseEther("1").sub(100000), 0, {
          from: bob.address,
        });
      expect(await clerkAsAlice.balanceOf(wbnb.address, bob.address), "token should be withdrawn").to.be.equal(100000);
    });
    context("when BNB transfer failed", () => {
      it("should revert", async function () {
        await wbnb.connect(alice).deposit({
          value: 1,
        });
        await clerk.connect(bob).deposit(wbnb.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0, {
          from: bob.address,
          value: ethers.utils.parseEther("1"),
        });
        await expect(
          clerk
            .connect(bob)
            .withdraw(wbnb.address, bob.address, flashloaner.address, ethers.utils.parseEther("1").sub(100000), 0, {
              from: bob.address,
            })
        ).to.be.revertedWith("Clerk::withdraw:: BNB transfer failed");
      });
    });

    it("Emits LogWithdraw event with expected arguments", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1"));

      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("1"),
        0
      );

      await expect(clerkAsAlice.withdraw(stakingTokens[0].address, alice.address, alice.address, 1, 0))
        .to.emit(clerk, "LogWithdraw")
        .withArgs(stakingTokens[0].address, alice.address, alice.address, 1, 1);
    });
  });

  describe("#withdraw() - From", function () {
    it("Mutates Clerk balanceOf and token balanceOf for from and to correctly", async function () {
      const bobStartBalance = await stakingTokens[0].balanceOf(bob.address);
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1"));

      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("1"),
        0
      );

      await clerkAsAlice.withdraw(stakingTokens[0].address, alice.address, bob.address, 1, 0);

      expect(await stakingTokens[0].balanceOf(bob.address), "bob should have received their tokens").to.be.equal(
        bobStartBalance.add(1)
      );
    });
  });

  describe("#transfer()", function () {
    it("Reverts when address zero is given as to argument", async function () {
      await expect(
        clerkAsAlice.transfer(stakingTokens[0].address, alice.address, constants.AddressZero, 1)
      ).to.be.revertedWith("Clerk::transfer:: to not set");
    });

    it("Reverts when attempting to transfer larger amount than available", async function () {
      await expect(clerkAsAlice.connect(bob).transfer(stakingTokens[0].address, bob.address, alice.address, 1)).to.be
        .reverted;
    });

    it("Reverts when attempting to transfer amount below vault protocol limit but above balance", async function () {
      await expect(
        clerk.connect(bob).transfer(stakingTokens[0].address, bob.address, alice.address, extremeValidVolume.toString())
      ).to.be.reverted;
    });

    it("Reverts when attempting to transfer vault protocol limit", async function () {
      await expect(
        clerk.connect(bob).transfer(stakingTokens[0].address, bob.address, alice.address, vaultProtocolLimit.toString())
      ).to.be.reverted;
    });

    it("Reverts when attempting to transfer computational limit", async function () {
      await expect(
        clerk.connect(bob).transfer(stakingTokens[0].address, bob.address, alice.address, computationalLimit.toString())
      ).to.be.reverted;
    });

    it("Mutates balanceOf for from and to correctly", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("100"));
      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("100"),
        0
      );
      await clerkAsAlice.transfer(stakingTokens[0].address, alice.address, bob.address, ethers.utils.parseEther("50"));

      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address),
        "token should be transferred"
      ).to.be.equal("50000000000000000000");
      expect(
        await clerkAsAlice.balanceOf(stakingTokens[0].address, bob.address),
        "token should be transferred"
      ).to.be.equal("50000000000000000000");
    });

    it("Emits LogTransfer event with expected arguments", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 1000);

      await clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, 1000, 0);

      await expect(clerkAsAlice.transfer(stakingTokens[0].address, alice.address, bob.address, 200))
        .to.emit(clerk, "LogTransfer")
        .withArgs(stakingTokens[0].address, alice.address, bob.address, 200);
    });
  });

  describe("#transfer() - Multiple", function () {
    context("if the first argument is address zero", () => {
      it("Reverts if first to argument is address zero", async function () {
        await expect(
          clerkAsAlice.transferMultiple(stakingTokens[0].address, alice.address, [constants.AddressZero], [1])
        ).to.be.reverted;
      });
    });

    it("should allow transfer multiple from alice to bob and carol", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, 2000);
      await clerkAsAlice.deposit(stakingTokens[0].address, alice.address, alice.address, 2000, 0);

      await clerkAsAlice.transferMultiple(
        stakingTokens[0].address,
        alice.address,
        [bob.address, carol.address],
        [500, 400]
      );

      expect(await clerkAsAlice.balanceOf(stakingTokens[0].address, alice.address)).to.equal(1100);
      expect(await clerkAsAlice.balanceOf(stakingTokens[0].address, bob.address)).to.equal(500);
      expect(await clerkAsAlice.balanceOf(stakingTokens[0].address, carol.address)).to.equal(400);
    });

    it("revert on multiple transfer at vault protocol limit from alice to both bob and carol", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, vaultProtocolLimit.toString());
      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("1"),
        0
      );

      await expect(
        clerkAsAlice.transferMultiple(
          stakingTokens[0].address,
          alice.address,
          [bob.address, carol.address],
          [vaultProtocolLimit.toString(), vaultProtocolLimit.toString()]
        )
      ).to.be.reverted;
    });

    it("revert on multiple transfer at vault protocol limit from alice to bob only", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, vaultProtocolLimit.toString());
      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("1"),
        0
      );

      await expect(
        clerkAsAlice.transferMultiple(
          stakingTokens[0].address,
          alice.address,
          [bob.address, carol.address],
          [vaultProtocolLimit.toString(), ethers.utils.parseEther("1")]
        )
      ).to.be.reverted;
    });

    it("revert on multiple transfer at computational limit from alice to both bob and carol", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, computationalLimit.toString());
      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("1"),
        0
      );

      await expect(
        clerkAsAlice.transferMultiple(
          stakingTokens[0].address,
          alice.address,
          [bob.address, carol.address],
          [computationalLimit.toString(), computationalLimit.toString()]
        )
      ).to.be.reverted;
    });

    it("revert on multiple transfer at computational limit from alice to bob only", async function () {
      await stakingTokens[0].connect(alice).approve(clerkAsAlice.address, computationalLimit.toString());
      await clerkAsAlice.deposit(
        stakingTokens[0].address,
        alice.address,
        alice.address,
        ethers.utils.parseEther("1"),
        0
      );

      await expect(
        clerkAsAlice.transferMultiple(
          stakingTokens[0].address,
          alice.address,
          [bob.address, carol.address],
          [computationalLimit.toString(), ethers.utils.parseEther("1")]
        )
      ).to.be.reverted;
    });
  });

  describe("#setStrategy()", function () {
    it("should allow to set strategy", async function () {
      await clerk.setStrategy(stakingTokens[0].address, stakingTokens[0].address);
    });

    it("should not allow bob to set Strategy", async function () {
      await expect(clerkAsAlice.connect(bob).setStrategy(stakingTokens[0].address, stakingTokens[0].address)).to.be
        .reverted;
    });

    it("should allow to exit strategy", async function () {
      await clerk.setStrategy(stakingTokens[0].address, constants.AddressZero);
      await increaseTimestamp(duration.weeks(BigNumber.from(2)));
      await clerk.setStrategy(stakingTokens[0].address, constants.AddressZero);
    });
  });
});
