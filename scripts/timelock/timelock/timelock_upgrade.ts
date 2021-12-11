import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades, network } from "hardhat";
import {
  getConfig,
  ITimelockResponse,
  withNetworkFile,
  FileService,
  TimelockService,
  IDevelopConfig,
} from "../../../utils";
import { LatteSwapYieldStrategy__factory } from "../../../compiled-typechain/v8";

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
  const TARGET_CONTRACT = (config as IDevelopConfig).FlatYieldStrategy["LatteSwap"]["USDT-BUSD"];
  const FACTORY = (await ethers.getContractFactory("LatteSwapYieldStrategy")) as LatteSwapYieldStrategy__factory;
  const EXACT_ETA = "1638880020";

  const timelockTransactions: Array<ITimelockResponse> = [];

  console.log(`============`);
  console.log(`>> Upgrading Contract through Timelock + ProxyAdmin`);
  console.log(">> Prepare upgrade & deploy if needed a new IMPL automatically.");
  const prepared = await upgrades.prepareUpgrade(TARGET_CONTRACT, FACTORY);
  console.log(`>> Implementation address: ${prepared}`);
  console.log("✅ Done");

  console.log(`>> Queue tx on Timelock to upgrade the implementation`);
  timelockTransactions.push(
    await TimelockService.queueTransaction(
      `queue tx on Timelock to upgrade the implementation to ${prepared}`,
      config.ProxyAdmin,
      "0",
      "upgrade(address,address)",
      ["address", "address"],
      [TARGET_CONTRACT, prepared],
      EXACT_ETA
    )
  );
  console.log("✅ Done");
  await FileService.write("upgrade-contract", timelockTransactions);
  console.log(`============`);
}

withNetworkFile(main)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
