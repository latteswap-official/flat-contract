import { ethers, waffle } from "hardhat";
import { BigNumber, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { lpChainlinkAggregatorUnitTestFixture } from "../helpers";
import { LPChainlinkAggregator } from "../../typechain/v8";
import { MockContract } from "@eth-optimism/smock";
import { assertBigNumberClose, assertBigNumberClosePercent } from "../helpers/assert";
import { parseUnits } from "ethers/lib/utils";

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
          token0Reserve: BigNumber.from("149681165696323435998144252"),
          token1Reserve: BigNumber.from("238536815945335816428077"),
          timestamp: "1635246615",
          totalSupply: BigNumber.from("4956871770040299418887006"),
          p0LatestAnswer: BigNumber.from("100042528"),
          p1LatestAnswer: BigNumber.from("62778480500"),
          totalUSD: BigNumber.from("149681165696323435998144252").mul(2),
          hasUSD: true,
        },
        {
          // Mock BTCB-BNB reserves as of 26/10/2021
          token0Reserve: BigNumber.from("1145351984420813854759"),
          token1Reserve: BigNumber.from("117672261716778619340198"),
          timestamp: "1635246615",
          totalSupply: BigNumber.from("11062389944077483611798"),
          p0LatestAnswer: BigNumber.from("6477958711045"),
          p1LatestAnswer: BigNumber.from("62778480500"),
          totalUSD: constants.Zero,
          hasUSD: false,
        },
        {
          // Mock BTCB-BUSD reserves as of 26/10/2021
          token0Reserve: BigNumber.from("890995832092113200734"),
          token1Reserve: BigNumber.from("57630473172967486370481746"),
          timestamp: "1635246615",
          totalSupply: BigNumber.from("211747360381132745795516"),
          p0LatestAnswer: BigNumber.from("6460448300000"),
          p1LatestAnswer: BigNumber.from("100000000"),
          totalUSD: BigNumber.from("57630473172967486370481746").mul(2),
          hasUSD: true,
        },
      ];

      for (const _case of cases) {
        lattePair.smocked.getReserves.will.return.with([_case.token0Reserve, _case.token1Reserve, _case.timestamp]);
        lattePair.smocked.totalSupply.will.return.with(_case.totalSupply);
        // Mock BUSD price for px0
        px0Aggregator.smocked.latestAnswer.will.return.with(_case.p0LatestAnswer);
        // Mock BUSD price for px1
        px1Aggregator.smocked.latestAnswer.will.return.with(_case.p1LatestAnswer);

        assertBigNumberClosePercent(
          _case.hasUSD
            ? _case.totalUSD.mul(constants.WeiPerEther).div(_case.totalSupply).toString()
            : _case.token0Reserve
                .mul(_case.p0LatestAnswer.mul(parseUnits("1", 10)))
                .add(_case.token1Reserve.mul(_case.p1LatestAnswer).mul(parseUnits("1", 10)))
                .div(_case.totalSupply)
                .toString(), // non-fair lp price, but should be ok for assertion tho
          (await lpChainlinkAggregator.latestAnswer()).toString(),
          "0.03"
        );
      }
    });
  });
});
