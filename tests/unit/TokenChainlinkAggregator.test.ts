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
  let mockRefTOKENUSD: MockContract;
  let tokenChainlinkAggregator: TokenChainlinkAggregator;

  beforeEach(async () => {
    ({ simpleToken, wbnb, mockRefBNBBUSD, mockRefTOKENBNB, mockRefTOKENUSD, tokenChainlinkAggregator } =
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
    context("with existing ref busd", () => {
      context("when updated at is >= delay threshold", () => {
        it("should return latest answer", async () => {
          await tokenChainlinkAggregator.setRefUSD(mockRefTOKENUSD.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(86400); //1 day delay, should be impossible to be less than this threshold
          mockRefTOKENUSD.smocked.decimals.will.return.with(8);
          mockRefTOKENUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("168", 8),
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
          await tokenChainlinkAggregator.setRefUSD(mockRefTOKENUSD.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(1); //1 day delay, should be impossible to be less than this threshold
          await increaseTimestamp(duration.seconds(BigNumber.from(2)));
          mockRefTOKENUSD.smocked.decimals.will.return.with(8);
          mockRefTOKENUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("168", 8),
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

    context("with existing ref bnb", () => {
      context("when updated at is >= delay threshold", () => {
        it("should return latest answer", async () => {
          await tokenChainlinkAggregator.setRefBNB(mockRefTOKENBNB.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(86400); //1 day delay, should be impossible to be less than this threshold

          mockRefTOKENBNB.smocked.decimals.will.return.with(18);
          mockRefTOKENBNB.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("3", 18),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);
          mockRefBNBBUSD.smocked.decimals.will.return.with(8);
          mockRefBNBBUSD.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("400", 8),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);

          expect(await tokenChainlinkAggregator.latestAnswer(), "should be equal to mocked latest round data").to.eq(
            ethers.utils.parseEther("1200")
          );
        });
      });

      context("when updated at is < delay threshold", () => {
        it("should revert", async () => {
          await tokenChainlinkAggregator.setRefBNB(mockRefTOKENBNB.address);
          const latestTimeStamp = await latestTimestamp();
          await tokenChainlinkAggregator.setMaxDelayTime(1); //1 day delay, should be impossible to be less than this threshold
          await increaseTimestamp(duration.seconds(BigNumber.from(2)));

          mockRefTOKENBNB.smocked.decimals.will.return.with(18);
          mockRefTOKENBNB.smocked.latestRoundData.will.return.with([
            constants.Zero,
            ethers.utils.parseUnits("3", 18),
            constants.Zero,
            latestTimeStamp,
            constants.Zero,
          ]);
          mockRefBNBBUSD.smocked.decimals.will.return.with(8);
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
