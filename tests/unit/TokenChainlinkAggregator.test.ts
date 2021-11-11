import { ethers, waffle } from "hardhat";
import { BigNumber, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { tokenChainlinkAggregatorUnitTestFixture } from "../helpers";
import { SimpleToken, TokenChainlinkAggregator } from "../../typechain/v8";
import { MockContract } from "@eth-optimism/smock";
import { duration, increaseTimestamp, latestTimestamp } from "../helpers/time";

chai.use(solidity);
const { expect } = chai;

describe("TokenChainlinkAggregator", () => {
  // Contract bindings
  let simpleToken: SimpleToken;
  let wbnb: SimpleToken;
  let mockRefBNBBUSD: MockContract;
  let mockRefTOKENBNB: MockContract;
  let mockRefTOKENBUSD: MockContract;
  let tokenChainlinkAggregator: TokenChainlinkAggregator;

  beforeEach(async () => {
    ({ simpleToken, wbnb, mockRefBNBBUSD, mockRefTOKENBNB, mockRefTOKENBUSD, tokenChainlinkAggregator } =
      await waffle.loadFixture(tokenChainlinkAggregatorUnitTestFixture));
  });

  context("#latestAnswer()", () => {
    context("when max delay time not set", () => {
      it("should revert", async () => {
        await expect(
          tokenChainlinkAggregator.latestAnswer(),
          "should reverted since the timestamp < threshold time"
        ).to.revertedWith("TokenChainlinkAggregator::latestAnswer::max delay time not set");
      });
    });
    context("with existing ref bnb", () => {
      context("when updated at is >= delay threshold", () => {
        it("should return latest answer", async () => {
          await tokenChainlinkAggregator.setRefBNB(mockRefTOKENBNB.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(86400); //1 day delay, should be impossible to be less than this threshold

          mockRefTOKENBNB.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseEther("168"),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          expect(await tokenChainlinkAggregator.latestAnswer(), "should be equal to mocked latest round data").to.eq(
            ethers.utils.parseEther("168")
          );
        });
      });
      context("when updated at is < delay threshold", () => {
        it("should revert", async () => {
          await tokenChainlinkAggregator.setRefBNB(mockRefTOKENBNB.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(1); //1 day delay, should be impossible to be less than this threshold
          await increaseTimestamp(duration.seconds(BigNumber.from(2)));

          mockRefTOKENBNB.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseEther("168"),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          await expect(
            tokenChainlinkAggregator.latestAnswer(),
            "should reverted since the timestamp < threshold time"
          ).to.revertedWith("TokenChainlinkAggregator::latestAnswer::delayed update time");
        });
      });
    });

    context("with existing ref busd", () => {
      context("when updated at is >= delay threshold", () => {
        it("should return latest answer", async () => {
          await tokenChainlinkAggregator.setRefUSD(mockRefTOKENBUSD.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(86400); //1 day delay, should be impossible to be less than this threshold

          mockRefTOKENBUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("2000", 8),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          mockRefBNBBUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("400", 8),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          expect(await tokenChainlinkAggregator.latestAnswer(), "should be equal to mocked latest round data").to.eq(
            ethers.utils.parseEther("5")
          );
        });
      });

      context("when updated at is < delay threshold", () => {
        it("should revert", async () => {
          await tokenChainlinkAggregator.setRefUSD(mockRefTOKENBUSD.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(1); //1 day delay, should be impossible to be less than this threshold
          await increaseTimestamp(duration.seconds(BigNumber.from(2)));

          mockRefTOKENBUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("2000", 8),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          mockRefBNBBUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("400", 8),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          await expect(
            tokenChainlinkAggregator.latestAnswer(),
            "should reverted since the timestamp < threshold time"
          ).to.revertedWith("TokenChainlinkAggregator::latestAnswer::delayed update time");
        });
      });
    });
  });
});
