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
  let nonce = await deployer.getTransactionCount();
  const config = getConfig();
  const FLAT_MARKET_CONFIG = config.FlatMarketConfig;
  const PARAMS = [
    {
      // market params
      CLERK: config.Clerk,
      FLAT: config.FLAT,
      COLLATERAL_TOKEN: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0",
      ORACLE: (config as IDevelopConfig).Oracle["OffChain"],
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        ["0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", constants.AddressZero]
      ),
      // config params
      COLLATERAL_FACTOR: "7500",
      LIQUIDATION_PENALTY: "10500",
      LIQUIDATION_TREASURY_BPS: "500",
      MIN_DEBT_SIZE: "1000",
      INTEREST_PER_SECOND: "317097920",
    },
  ];

  await withNetworkFile(async () => {
    let tx;
    const flatMarketConfig = FlatMarketConfig__factory.connect(FLAT_MARKET_CONFIG, deployer);
    const markets = [];

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
      nonce++;

      await flatMarket.deployed();
      console.log(`>> Deployed at ${flatMarket.address}`);
      console.log("✅ Done deploying FlatMarket");

      const clerk = Clerk__factory.connect(PARAM.CLERK, deployer);

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
      })),
      { gasPrice: ethers.utils.parseUnits("20", "gwei"), nonce: nonce++ }
    );
    console.log(`✅ Done at tx ${tx.hash}`);
  });
};

export default func;
func.tags = ["DeployFlatMarketBundle"];
