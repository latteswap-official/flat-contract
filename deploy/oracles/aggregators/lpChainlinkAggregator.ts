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
  const LP = "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0";
  const CHAINLINK_TOKEN0_ORACLE = "0xB6064eD41d4f67e353768aA239cA86f4F73665a1";
  const CHAINLINK_TOKEN1_ORACLE = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE";

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
