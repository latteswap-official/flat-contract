import { ethers, network, upgrades } from "hardhat";
import {
  Clerk,
  Clerk__factory,
  FlatMarket,
  FlatMarket__factory,
  LatteSwapYieldStrategy,
  LatteSwapYieldStrategy__factory,
  PCSYieldStrategy,
  PCSYieldStrategy__factory,
} from "../../typechain/v8";
import { getConfig, IDevelopConfig, withNetworkFile } from "../../utils";

async function main() {
  /*
  ░██╗░░░░░░░██╗░█████╗░██████╗░███╗░░██╗██╗███╗░░██╗░██████╗░
  ░██║░░██╗░░██║██╔══██╗██╔══██╗████╗░██║██║████╗░██║██╔════╝░
  ░╚██╗████╗██╔╝███████║██████╔╝██╔██╗██║██║██╔██╗██║██║░░██╗░
  ░░████╔═████║░██╔══██║██╔══██╗██║╚████║██║██║╚████║██║░░╚██╗
  ░░╚██╔╝░╚██╔╝░██║░░██║██║░░██║██║░╚███║██║██║░╚███║╚██████╔╝
  ░░░╚═╝░░░╚═╝░░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝╚═╝░░╚══╝░╚═════╝░
  Check all variables below before execute the deployment script
  */
  const config = getConfig();
  const TARGET_CONTRACT = (config as IDevelopConfig).FlatYieldStrategy["PCS"]["CAKE-BNB"];
  console.log(`>> Upgrading a Contract ${TARGET_CONTRACT}`);
  const Contract = (await ethers.getContractFactory(
    "PCSYieldStrategy",
    (
      await ethers.getSigners()
    )[0]
  )) as PCSYieldStrategy__factory;
  const contract = (await upgrades.upgradeProxy(TARGET_CONTRACT, Contract)) as PCSYieldStrategy;
  await contract.deployed();
  console.log(`✅ Done Upgrading a Contract`);
}

withNetworkFile(main)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
