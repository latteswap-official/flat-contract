import { ethers, waffle } from "hardhat";
import { BigNumber, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { lpChainlinkAggregatorUnitTestFixture } from "../helpers";
import { LPChainlinkAggregator } from "../../typechain/v8";
import { MockContract } from "@eth-optimism/smock";
import { assertBigNumberClose, assertBigNumberClosePercent } from "../helpers/assert";

chai.use(solidity);
const { expect } = chai;

describe("LPChainlinkAggregator", () => {
  // Contract bindings
  let px0Aggregator: MockContract;
  let px1Aggregator: MockContract;
  let lattePair: MockContract;
  let lpChainlinkAggregator: LPChainlinkAggregator;

  beforeEach(async () => {
    ({ px0Aggregator, px1Aggregator, lattePair, lpChainlinkAggregator } = await waffle.loadFixture(
      lpChainlinkAggregatorUnitTestFixture
    ));
  });

  context("#latestAnswer()", () => {
    it("should return a correct fair lp price", async () => {
      const cases = [
        {
          // Mock USDT-BNB reserves as of 26/10/2021
          token0Reserve: BigNumber.from("144297232309821388024114171"),
          token1Reserve: BigNumber.from("297388328910698975602105"),
          timestamp: "1635246615",
          totalSupply: BigNumber.from("5516904403782558199235815"),
          p0LatestAnswer: BigNumber.from("2060694178194711"),
          p1LatestAnswer: ethers.utils.parseEther("1"),
          totalBnb: BigNumber.from("297388328910698975602105").mul(2),
          hasBnb: true,
        },
        {
          // Mock BTCB-BNB reserves as of 26/10/2021
          token0Reserve: BigNumber.from("1683623474148470069646"),
          token1Reserve: BigNumber.from("212300121413569965773199"),
          timestamp: "1635246615",
          totalSupply: BigNumber.from("18072702183927274249304"),
          p0LatestAnswer: BigNumber.from("126103706658610680000"),
          p1LatestAnswer: ethers.utils.parseEther("1"),
          totalBnb: BigNumber.from("212300121413569965773199").mul(2),
          hasBnb: true,
        },
        {
          // Mock BTCB-BUSD reserves as of 26/10/2021
          token0Reserve: BigNumber.from("1040304577677254288105"),
          token1Reserve: BigNumber.from("63460947420840552075704159"),
          timestamp: "1635246615",
          totalSupply: BigNumber.from("240715535936845319007230"),
          p0LatestAnswer: BigNumber.from("126103706658610680000"),
          p1LatestAnswer: BigNumber.from("2061755576837038"),
          totalBnb: constants.Zero,
          hasBnb: false,
        },
      ];

      for (const _case of cases) {
        lattePair.smocked.getReserves.will.return.with([_case.token0Reserve, _case.token1Reserve, _case.timestamp]);
        lattePair.smocked.totalSupply.will.return.with(_case.totalSupply);
        // Mock BNB price for px0
        px0Aggregator.smocked.latestAnswer.will.return.with(_case.p0LatestAnswer);
        // Mock BNB price for px1
        px1Aggregator.smocked.latestAnswer.will.return.with(_case.p1LatestAnswer);

        assertBigNumberClosePercent(
          _case.hasBnb
            ? _case.totalBnb.mul(constants.WeiPerEther).div(_case.totalSupply).toString()
            : _case.token0Reserve
                .mul(_case.p0LatestAnswer)
                .add(_case.token1Reserve.mul(_case.p1LatestAnswer))
                .div(_case.totalSupply)
                .toString(), // non-fair lp price, but should be ok for assertion tho
          (await lpChainlinkAggregator.latestAnswer()).toString()
        );
      }
    });
  });
});
