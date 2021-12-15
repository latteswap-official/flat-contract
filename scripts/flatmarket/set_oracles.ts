import { BigNumberish, constants } from "ethers";
import { ethers, network } from "hardhat";
import { FlatMarket__factory } from "../../compiled-typechain/v8";
import { CompositeOracle__factory } from "../../typechain/v8";
import { withNetworkFile, getConfig, IDevelopConfig } from "../../utils";

interface ISetOracleParam {
  MARKET: string;
  ORACLE: string;
  ORACLE_DATA: string;
}

type ISetOracleParams = Array<ISetOracleParam>;

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
  const deployer = (await ethers.getSigners())[0];
  let nonce = await deployer.getTransactionCount();
  const config = getConfig();
  const PARAMS: ISetOracleParams = [
    {
      MARKET: (config as IDevelopConfig).FlatMarket["USDT-BUSD"],
      ORACLE: (config as IDevelopConfig).Oracle["Composite"],
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0x318B894003D0EAcfEDaA41B8c70ed3CE1Fde1450"]),
    },
    {
      MARKET: (config as IDevelopConfig).FlatMarket["PCS_CAKE-WBNB"],
      ORACLE: (config as IDevelopConfig).Oracle["Composite"],
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0x0eD7e52944161450477ee417DE9Cd3a859b14fD0"]),
    },
  ];

  for (const param of PARAMS) {
    const flatMarket = FlatMarket__factory.connect(param.MARKET, deployer);

    const tx = await flatMarket.setOracle(param.ORACLE, param.ORACLE_DATA, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });

    console.log(`>> returned tx hash: ${tx.hash}`);
    console.log("✅ Done");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
