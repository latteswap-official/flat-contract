import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { PCSYieldStrategy, PCSYieldStrategy__factory } from "../../../typechain/v8";
import { getConfig, withNetworkFile } from "../../../utils";

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
  const PCS_MASTERCHEF = "";
  const STAKING_TOKEN = "";

  await withNetworkFile(async () => {
    console.log(`deploying a PCS Yield Strategy`);

    const PCSYieldStrategy = (await ethers.getContractFactory(
      "PCSYieldStrategy",
      deployer
    )) as PCSYieldStrategy__factory;
    const pcsYieldStrategy = (await upgrades.deployProxy(PCSYieldStrategy, [
      PCS_MASTERCHEF,
      STAKING_TOKEN,
    ])) as PCSYieldStrategy;

    await pcsYieldStrategy.deployed();
    console.log(`>> Deployed at ${pcsYieldStrategy.address}`);
    console.log("✅ Done deploying a PCS Yield Strategy");
  });
};

export default func;
func.tags = ["DeployPCSYieldStrategy"];
