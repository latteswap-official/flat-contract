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
  const FLAT_MARKET_CONFIG = config.FlatMarketConfig;
  const PARAM = {
    FLAT_MARKET: "0x8f64D47b98c67fDA885860B611673669aF90B62E",
    // market params
    CLERK: config.Clerk,
    FLAT: config.FLAT,
    COLLATERAL_TOKEN: "0xF45cd219aEF8618A92BAa7aD848364a158a24F33",
    ORACLE: config.Oracle.Composite,
    ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0xF45cd219aEF8618A92BAa7aD848364a158a24F33"]),
    // config params
    COLLATERAL_FACTOR: "7000",
    LIQUIDATION_PENALTY: "10500",
    LIQUIDATION_TREASURY_BPS: "8000",
    MIN_DEBT_SIZE: ethers.utils.parseEther("500"), // 500 FLAT
    INTEREST_PER_SECOND: "792744799",
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
