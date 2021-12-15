import { ethers, network, upgrades } from "hardhat";
import { LatteSwapYieldStrategy, LatteSwapYieldStrategy__factory } from "../../compiled-typechain/v8";
import { Clerk, Clerk__factory } from "../../typechain/v8";
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
  const TARGET_CONTRACT = (config as IDevelopConfig).Clerk;
  console.log(`>> Upgrading a Contract`);
  const Contract = (await ethers.getContractFactory("Clerk", (await ethers.getSigners())[0])) as Clerk__factory;
  const contract = (await upgrades.upgradeProxy(TARGET_CONTRACT, Contract)) as Clerk;
  await contract.deployed();
  console.log(`✅ Done Upgrading a Contract`);
}

withNetworkFile(main)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
