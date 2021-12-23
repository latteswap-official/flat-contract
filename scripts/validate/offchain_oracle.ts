import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { OffChainOracle, OffChainOracle__factory } from "../../typechain/v8";
import { getConfig, IDevelopConfig, withNetworkFile } from "../../utils";
import { constants } from "ethers";
import { expect } from "chai";

const main = async () => {
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
  const OFFCHAIN_ORACLE = "0xb9ed72e920A04815db745bFd802f3134658a6D8d";
  const FEEDER = "0x3eEa288a952d76e7CC7b391360eDAD7d55CccEBd";

  const offchainOracle = OffChainOracle__factory.connect(OFFCHAIN_ORACLE, deployer);

  console.log(`>> expect offchain oracle to set feeder role to ${FEEDER}`);
  expect(await offchainOracle.hasRole(await offchainOracle.FEEDER_ROLE(), FEEDER)).to.be.true;
  console.log(">> ✅ DONE");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
