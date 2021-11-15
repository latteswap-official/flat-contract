import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { flatMarketUnitTestFixture } from "../helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { FlatMarket, FlatMarket__factory } from "../../typechain/v8";
import { MockContract } from "@eth-optimism/smock";

chai.use(solidity);
const { expect } = chai;

// This will only test error handling, all other tests are included in "integrations"
describe("FlatMarket", () => {
  // Accounts
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;

  // Contract
  let mockedSimpleToken: MockContract;
  let mockedClerk: MockContract;
  let mockedFlat: MockContract;
  let mockedCompositeOracle: MockContract;
  let mockedFlatMarketConfig: MockContract;
  let flatMarket: FlatMarket;

  // Contact instance with Signer
  let flatMarketAsAlice: FlatMarket;

  beforeEach(async () => {
    ({
      deployer,
      alice,
      mockedSimpleToken,
      mockedClerk,
      mockedFlat,
      mockedCompositeOracle,
      mockedFlatMarketConfig,
      flatMarket,
    } = await waffle.loadFixture(flatMarketUnitTestFixture));

    flatMarketAsAlice = FlatMarket__factory.connect(flatMarket.address, alice);
  });

  context("when treasury is not set", async () => {
    it("should revert when call withdrawSurplus", async () => {
      mockedFlatMarketConfig.smocked.treasury.will.return.with(ethers.constants.AddressZero);
      await expect(flatMarketAsAlice.withdrawSurplus()).to.be.revertedWith("bad treasury");
    });

    it("should revert when kill is called", async () => {
      mockedFlatMarketConfig.smocked.liquidationPenalty.will.return.with(10500);
      mockedFlatMarketConfig.smocked.liquidationTreasuryBps.will.return.with(500);
      mockedFlatMarketConfig.smocked.treasury.will.return.with(ethers.constants.AddressZero);
      await expect(
        flatMarketAsAlice.kill(
          [alice.address],
          [ethers.constants.MaxUint256],
          deployer.address,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("bad treasury");
    });
  });

  context("when bad liquidition penalty", async () => {
    it("should revert when kill is called", async () => {
      mockedFlatMarketConfig.smocked.liquidationPenalty.will.return.with(0);
      await expect(
        flatMarketAsAlice.kill(
          [alice.address],
          [ethers.constants.MaxUint256],
          deployer.address,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("bad liquidation penalty");
    });
  });

  context("when bad treasury bps", async () => {
    it("should revert when kill is called", async () => {
      mockedFlatMarketConfig.smocked.liquidationPenalty.will.return.with(10500);
      mockedFlatMarketConfig.smocked.liquidationTreasuryBps.will.return.with(0);
      await expect(
        flatMarketAsAlice.kill(
          [alice.address],
          [ethers.constants.MaxUint256],
          deployer.address,
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("bad liquidation treasury bps");
    });
  });

  context("when oracle fail", async () => {
    it("should revert when borrow", async () => {
      mockedCompositeOracle.smocked.get.will.return.with([false, ethers.utils.parseEther("1")]);
      await expect(
        flatMarketAsAlice.borrow(
          alice.address,
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1"),
          ethers.utils.parseEther("1")
        )
      ).to.be.revertedWith("bad price");
    });
  });
});
