import { ethers, waffle } from "hardhat";
import { BigNumber, constants } from "ethers";
import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { offChainOracleUnitTestFixture } from "../helpers";
import { OffChainOracle, SimpleToken } from "../../typechain/v8";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { duration, increaseTimestamp } from "../helpers/time";

describe("OffChainOracle", () => {
  // Contract bindings
  let offChainOracle: OffChainOracle;
  let simpleTokens: Array<SimpleToken>;

  let alice: SignerWithAddress;

  beforeEach(async () => {
    [, alice] = await ethers.getSigners();
    ({ offChainOracle, simpleTokens } = await waffle.loadFixture(offChainOracleUnitTestFixture));
  });

  describe("#setPrices()", () => {
    context("when price setter is not a feeder", () => {
      it("should revert", async () => {
        await expect(
          offChainOracle.setPrices(
            [simpleTokens[0].address, simpleTokens[1].address],
            [simpleTokens[0].address, simpleTokens[1].address, simpleTokens[2].address],
            []
          )
        ).to.be.revertedWith("OffChainOracle::onlyFeeder::only FEEDER role");
      });
    });
    context("when inconsistent length", () => {
      context("with inconsistent tokens", () => {
        it("should revert", async () => {
          await offChainOracle.grantRole(await offChainOracle.FEEDER_ROLE(), alice.address);
          await expect(
            offChainOracle
              .connect(alice)
              .setPrices(
                [simpleTokens[0].address, simpleTokens[1].address],
                [simpleTokens[0].address, simpleTokens[1].address, simpleTokens[2].address],
                []
              )
          ).to.be.revertedWith("OffChainOracle::setPrices:: bad token1s length");
        });
      });

      context("with inconsistent token and price", () => {
        it("should revert", async () => {
          await offChainOracle.grantRole(await offChainOracle.FEEDER_ROLE(), alice.address);
          await expect(
            offChainOracle
              .connect(alice)
              .setPrices(
                [simpleTokens[0].address, simpleTokens[1].address, simpleTokens[2].address],
                [simpleTokens[0].address, simpleTokens[1].address, simpleTokens[2].address],
                [simpleTokens[0].address]
              )
          ).to.be.revertedWith("OffChainOracle::setPrices:: bad prices length");
        });
      });
    });
    context("with correct params", () => {
      it("should be able to set the price", async () => {
        await offChainOracle.grantRole(await offChainOracle.FEEDER_ROLE(), alice.address);
        await offChainOracle
          .connect(alice)
          .setPrices(
            [simpleTokens[0].address, simpleTokens[1].address],
            [simpleTokens[1].address, simpleTokens[0].address],
            [ethers.utils.parseEther("100"), ethers.utils.parseEther("0.01")]
          );
        let [, price] = await offChainOracle.get(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address"],
            [simpleTokens[0].address, simpleTokens[1].address]
          )
        );

        expect(price, "expect to get the correct price (should be 100)").to.eq(ethers.utils.parseEther("100"));

        [, price] = await offChainOracle.get(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address"],
            [simpleTokens[1].address, simpleTokens[0].address]
          )
        );

        expect(price, "expect to get the correct price (should be 0.01)").to.eq(ethers.utils.parseEther("0.01"));

        await expect(
          offChainOracle.get(
            ethers.utils.defaultAbiCoder.encode(
              ["address", "address"],
              [simpleTokens[1].address, simpleTokens[1].address]
            )
          ),
          "since no token1 token1 pair, should revert as a bad price data"
        ).to.revertedWith("OffChainOracle::getPrice:: bad price data");
      });
    });
  });

  describe("#get()", () => {
    context("when the price is stale", () => {
      it("should return the price with success = false", async () => {
        await offChainOracle.grantRole(await offChainOracle.FEEDER_ROLE(), alice.address);
        await offChainOracle
          .connect(alice)
          .setPrices(
            [simpleTokens[0].address, simpleTokens[1].address],
            [simpleTokens[1].address, simpleTokens[0].address],
            [ethers.utils.parseEther("100"), ethers.utils.parseEther("0.01")]
          );
        await increaseTimestamp(duration.days(BigNumber.from(1)).add(duration.seconds(BigNumber.from(1))));
        const [success, price] = await offChainOracle.get(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address"],
            [simpleTokens[0].address, simpleTokens[1].address]
          )
        );
        expect(success, "expect to get the correct success (should be true)").to.eq(false);
        expect(price, "expect to get the correct price (should be 100)").to.eq(ethers.utils.parseEther("100"));
      });
    });

    context("when the price is not stale", () => {
      it("should return the price with success = true", async () => {
        await offChainOracle.grantRole(await offChainOracle.FEEDER_ROLE(), alice.address);
        await offChainOracle
          .connect(alice)
          .setPrices(
            [simpleTokens[0].address, simpleTokens[1].address],
            [simpleTokens[1].address, simpleTokens[0].address],
            [ethers.utils.parseEther("100"), ethers.utils.parseEther("0.01")]
          );
        const [success, price] = await offChainOracle.get(
          ethers.utils.defaultAbiCoder.encode(
            ["address", "address"],
            [simpleTokens[0].address, simpleTokens[1].address]
          )
        );
        expect(success, "expect to get the correct success (should be true)").to.eq(true);
        expect(price, "expect to get the correct price (should be 100)").to.eq(ethers.utils.parseEther("100"));
      });
    });
  });

  describe("#name()", () => {
    it("should return a correct name", async () => {
      expect(await offChainOracle.name([])).to.eq("OffChain");
    });
  });

  describe("#symbol()", () => {
    it("should return a correct symbol", async () => {
      expect(await offChainOracle.symbol([])).to.eq("OFFCHAIN");
    });
  });
});
