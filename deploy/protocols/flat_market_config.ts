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
import { getConfig, withNetworkFile } from "../../utils";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";

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
  const PARAM = {
    TREASURY_ACCOUNT: "0x8C6Dd14ef0e41037b5e87C7b93438837f6D8D1D2",
    CLERK: config.Clerk,
    FLAT: config.FLAT,
  };

  await withNetworkFile(async () => {
    console.log(`>> deploying an TreasuryHolder`);
    const TreasuryHolder = (await ethers.getContractFactory("TreasuryHolder", deployer)) as TreasuryHolder__factory;
    const treasuryHolder = (await upgrades.deployProxy(TreasuryHolder, [
      PARAM.TREASURY_ACCOUNT,
      PARAM.CLERK,
      PARAM.FLAT,
    ])) as TreasuryHolder;

    await treasuryHolder.deployed();
    console.log(`>> Deployed at ${treasuryHolder.address}`);
    console.log("✅ Done deploying TreasuryHolder");

    console.log(`>> deploying an FlatMarketConfig`);
    const FlatMarketConfig = (await ethers.getContractFactory(
      "FlatMarketConfig",
      deployer
    )) as FlatMarketConfig__factory;
    const flatMarketConfig = (await upgrades.deployProxy(FlatMarketConfig, [
      treasuryHolder.address,
    ])) as FlatMarketConfig;

    await flatMarketConfig.deployed();
    console.log(`>> Deployed at ${flatMarketConfig.address}`);
    console.log("✅ Done deploying FlatMarketConfig");
  });
};

export default func;
func.tags = ["DeployFlatMarketConfig"];
