import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { LPChainlinkAggregator, LPChainlinkAggregator__factory } from "../../../typechain/v8";
import { getConfig, withNetworkFile } from "../../../utils";
import { LatteSwapPair__factory } from "@latteswap/latteswap-contract/compiled-typechain";

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
  const LP = "0xf180466bBbaD8883360334309f558842e4B6eE59";
  const CHAINLINK_TOKEN0_ORACLE = "0xB97Ad0E74fa7d920791E90258A6E2085088b4320";
  const CHAINLINK_TOKEN1_ORACLE = "0xcBb98864Ef56E9042e7d2efef76141f15731B82f";

  await withNetworkFile(async () => {
    const pair = LatteSwapPair__factory.connect(LP, deployer);
    console.log(`deploying an LP Chainlink Aggregator ${await pair.token0()} - ${await pair.token1()} (${LP})`);
    const LPChainlinkAggregator = (await ethers.getContractFactory(
      "LPChainlinkAggregator",
      deployer
    )) as LPChainlinkAggregator__factory;
    const lpChainlinkAggregator = (await upgrades.deployProxy(LPChainlinkAggregator, [
      LP,
      CHAINLINK_TOKEN0_ORACLE,
      CHAINLINK_TOKEN1_ORACLE,
    ])) as LPChainlinkAggregator;

    await lpChainlinkAggregator.deployed();
    console.log(`>> Deployed at ${lpChainlinkAggregator.address}`);
    console.log("✅ Done deploying an LP Chainlink Aggregator");
  });
};

export default func;
func.tags = ["DeployLPChainlinkAggregator"];
