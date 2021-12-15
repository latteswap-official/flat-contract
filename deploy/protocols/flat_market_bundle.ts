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

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
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
  const PARAMS = [
    {
      // market params
      CLERK: "0xBf181131D87B2a7720d2Dd5095f9eCaA456bd735",
      FLAT: config.FLAT,
      COLLATERAL_TOKEN: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0",
      ORACLE: "0x554F4Ed695D801B2c2cceC0a9927977C264A50fb",
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0x0eD7e52944161450477ee417DE9Cd3a859b14fD0"]),
      // config params
      COLLATERAL_FACTOR: "7500",
      LIQUIDATION_PENALTY: "10500",
      LIQUIDATION_TREASURY_BPS: "500",
      MIN_DEBT_SIZE: ethers.utils.parseEther("5"), // 5 FLAT
      INTEREST_PER_SECOND: "100000000",
      CLOSE_FACTOR_BPS: "5000",
    },
  ];

  await withNetworkFile(async () => {
    let tx;
    const flatMarketConfig = FlatMarketConfig__factory.connect(FLAT_MARKET_CONFIG, deployer);
    const markets = [];
    let nonce = await deployer.getTransactionCount();

    for (const PARAM of PARAMS) {
      console.log(`>> deploying an FlatMarket`);
      const FlatMarket = (await ethers.getContractFactory("FlatMarket", deployer)) as FlatMarket__factory;
      const flatMarket = (await upgrades.deployProxy(FlatMarket, [
        PARAM.CLERK,
        PARAM.FLAT,
        PARAM.COLLATERAL_TOKEN,
        FLAT_MARKET_CONFIG,
        PARAM.ORACLE,
        PARAM.ORACLE_DATA,
      ])) as FlatMarket;

      await flatMarket.deployed();
      console.log(`>> Deployed at ${flatMarket.address}`);
      console.log("✅ Done deploying FlatMarket");

      const clerk = Clerk__factory.connect(PARAM.CLERK, deployer);
      nonce++;

      console.log(`>> whitelist market ${flatMarket.address} in CLERK`);
      tx = await clerk.whitelistMarket(flatMarket.address, true, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(`✅ Done at tx ${tx.hash}`);

      markets.push(flatMarket.address);
    }

    console.log(`>> set config in the config`);
    tx = await flatMarketConfig.setConfig(
      markets,
      PARAMS.map((p) => ({
        collateralFactor: p.COLLATERAL_FACTOR,
        liquidationPenalty: p.LIQUIDATION_PENALTY,
        liquidationTreasuryBps: p.LIQUIDATION_TREASURY_BPS,
        minDebtSize: p.MIN_DEBT_SIZE,
        interestPerSecond: p.INTEREST_PER_SECOND,
        closeFactorBps: p.CLOSE_FACTOR_BPS,
      })),
      { gasPrice: ethers.utils.parseUnits("20", "gwei"), nonce: nonce++ }
    );
    console.log(`✅ Done at tx ${tx.hash}`);
  });
};

export default func;
func.tags = ["DeployFlatMarketBundle"];
