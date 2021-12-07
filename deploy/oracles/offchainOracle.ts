import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { OffChainOracle, OffChainOracle__factory } from "../../typechain/v8";
import { withNetworkFile } from "../../utils";

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
  const FEEDER = "0x29D60B7DE99E00b715309Fd1CbfF3C29F232dd8E";

  await withNetworkFile(async () => {
    console.log(`>> deploying an OffChainOracle`);
    const OffChainOracle = (await ethers.getContractFactory("OffChainOracle", deployer)) as OffChainOracle__factory;
    const offchainOracle = (await upgrades.deployProxy(OffChainOracle)) as OffChainOracle;

    await offchainOracle.deployed();
    console.log(`>> Deployed at ${offchainOracle.address}`);
    console.log("✅ Done deploying OffChainOracle");

    console.log(`>> grant feeder role to ${FEEDER}`);
    const tx = await offchainOracle.grantRole(await offchainOracle.FEEDER_ROLE(), FEEDER, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
    });
    console.log(`✅ Done in tx ${tx.hash}`);
  });
};

export default func;
func.tags = ["DeployOffChainOracle"];
