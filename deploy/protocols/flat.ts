import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { FLAT, FLAT__factory } from "../../typechain/v8";
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
  const MINT_RANGE = 6 * 60 * 60; // 6 hours
  const MAX_MINT_BPS = 1500;

  await withNetworkFile(async () => {
    console.log(
      `deploying a FLAT with mint range equals ${MINT_RANGE / 60 / 60} hrs and max mint bps of ${MAX_MINT_BPS} `
    );

    const Flat = (await ethers.getContractFactory("FLAT", deployer)) as FLAT__factory;
    const flat = (await upgrades.deployProxy(Flat, [MINT_RANGE, MAX_MINT_BPS])) as FLAT;

    await flat.deployed();
    console.log(`>> Deployed at ${flat.address}`);
    console.log("✅ Done deploying a FLAT");
  });
};

export default func;
func.tags = ["DeployFLAT"];
