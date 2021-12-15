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
  const PARAM = {
    TREASURY_ACCOUNT: await deployer.getAddress(),
    CLERK: "0x140616edc7A9262788AB5c4D43a013D970de295B",
    FLAT: "0x0950F9553e02B0d0cCb1Eb76E71B7Abf7E3AB7c2",
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
