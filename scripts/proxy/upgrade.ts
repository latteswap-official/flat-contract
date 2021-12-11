import { ethers, network, upgrades } from "hardhat";
import { LatteSwapYieldStrategy, LatteSwapYieldStrategy__factory } from "../../compiled-typechain/v8";
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
  const TARGET_CONTRACT = (config as IDevelopConfig).FlatYieldStrategy["LatteSwap"]["LATTEv2-BUSD"];
  console.log(`>> Upgrading a Contract`);
  const Contract = (await ethers.getContractFactory(
    "LatteSwapYieldStrategy",
    (
      await ethers.getSigners()
    )[0]
  )) as LatteSwapYieldStrategy__factory;
  const contract = (await upgrades.upgradeProxy(TARGET_CONTRACT, Contract)) as LatteSwapYieldStrategy;
  await contract.deployed();
  console.log(`✅ Done Upgrading a Contract`);
}

withNetworkFile(main)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
