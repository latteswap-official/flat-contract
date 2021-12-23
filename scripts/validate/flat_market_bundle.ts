import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import {
  FlatMarketConfig,
  FlatMarketConfig__factory,
  FlatMarket,
  FlatMarket__factory,
  TreasuryHolder,
  TreasuryHolder__factory,
  Clerk,
  Clerk__factory,
} from "../../typechain/v8";
import { getConfig, IDevelopConfig, withNetworkFile } from "../../utils";
import { constants } from "ethers";
import { expect } from "chai";

const main = async () => {
  /*
  ░██╗░░░░░░░██╗░█████╗░██████╗░███╗░░██╗██╗███╗░░██╗░██████╗░
  ░██║░░██╗░░██║██╔══██╗██╔══██╗████╗░██║██║████╗░██║██╔════╝░
  ░╚██╗████╗██╔╝███████║██████╔╝██╔██╗██║██║██╔██╗██║██║░░██╗░
  ░░████╔═████║░██╔══██║██╔══██╗██║╚████║██║██║╚████║██║░░╚██╗
  ░░╚██╔╝░╚██╔╝░██║░░██║██║░░██║██║░╚███║██║██║░╚███║╚██████╔╝
  ░░░╚═╝░░░╚═╝░░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝╚═╝░░╚══╝░╚═════╝░
  Check all variables below before execute the deployment script
  */
  const deployer = (await ethers.getSigners())[0];
  const config = getConfig();
  const FLAT_MARKET_CONFIG = "0x7466D00b6EB69a62F1B2aDcbD8415367FaCBFBe3";
  const PARAM = {
    FLAT_MARKET: "0xe665686FE7e7fe00c69B74737FA4CDe78aaFCc3B",
    // market params
    CLERK: "0xBf181131D87B2a7720d2Dd5095f9eCaA456bd735",
    FLAT: config.FLAT,
    COLLATERAL_TOKEN: "0xDa01147B87d389d1BDB3c2dD28bf56c79BE74E3c",
    ORACLE: "0x554F4Ed695D801B2c2cceC0a9927977C264A50fb",
    ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0xDa01147B87d389d1BDB3c2dD28bf56c79BE74E3c"]),
    // config params
    COLLATERAL_FACTOR: "9000",
    LIQUIDATION_PENALTY: "10500",
    LIQUIDATION_TREASURY_BPS: "500",
    MIN_DEBT_SIZE: ethers.utils.parseEther("5"), // 5 FLAT
    INTEREST_PER_SECOND: "100000000",
    CLOSE_FACTOR_BPS: "5000",
  };

  const flatMarketConfig = FlatMarketConfig__factory.connect(FLAT_MARKET_CONFIG, deployer);
  const clerk = Clerk__factory.connect(PARAM.CLERK, deployer);
  const flatMarket = FlatMarket__factory.connect(PARAM.FLAT_MARKET, deployer);

  console.log(">> clerk should contain a whitelist market");
  expect(await clerk.whitelistedMarkets(PARAM.FLAT_MARKET), "clerk should contain a the flat market whitelist market")
    .to.be.true;
  console.log(">> ✅ pass");

  console.log(">> flat market config should contain all the required fields");
  const marketConfig = await flatMarketConfig.configs(PARAM.FLAT_MARKET);
  expect(marketConfig.collateralFactor, "collateralFactor").to.be.equal(PARAM.COLLATERAL_FACTOR);
  expect(marketConfig.liquidationPenalty, "liquidationPenalty").to.be.equal(PARAM.LIQUIDATION_PENALTY);
  expect(marketConfig.liquidationTreasuryBps, "liquidationTreasuryBps").to.be.equal(PARAM.LIQUIDATION_TREASURY_BPS);
  expect(marketConfig.minDebtSize, "minDebtSize").to.be.equal(PARAM.MIN_DEBT_SIZE);
  expect(marketConfig.interestPerSecond, "interestPerSecond").to.be.equal(PARAM.INTEREST_PER_SECOND);
  expect(marketConfig.closeFactorBps, "closeFactorBps").to.be.equal(PARAM.CLOSE_FACTOR_BPS);
  console.log(">> ✅ pass");

  console.log(">> flat market should contain all the required fields");
  expect(await flatMarket.oracle()).to.eq(PARAM.ORACLE);
  expect(await flatMarket.oracleData()).to.eq(PARAM.ORACLE_DATA);
  console.log(">> ✅ pass");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
