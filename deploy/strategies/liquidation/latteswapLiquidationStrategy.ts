import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { LatteSwapLiquidationStrategy, LatteSwapLiquidationStrategy__factory } from "../../../typechain/v8";
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
  const CLERK = "";
  const ROUTER = "";

  await withNetworkFile(async () => {
    console.log(`deploying a LatteSwap Liquidation Strategy`);

    const LatteSwapLiquidationStrategy = (await ethers.getContractFactory(
      "LatteSwapLiquidationStrategy",
      deployer
    )) as LatteSwapLiquidationStrategy__factory;
    const latteSwapLiquidationStrategy = (await upgrades.deployProxy(LatteSwapLiquidationStrategy, [
      CLERK,
      ROUTER,
    ])) as LatteSwapLiquidationStrategy;

    await latteSwapLiquidationStrategy.deployed();
    console.log(`>> Deployed at ${latteSwapLiquidationStrategy.address}`);
    console.log("✅ Done deploying a LatteSwap Liquidation Strategy");
  });
};

export default func;
func.tags = ["DeployLatteSwapLiquidationStrategy"];
