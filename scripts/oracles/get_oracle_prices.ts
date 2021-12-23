import { Timelock__factory } from "@latteswap/latteswap-contract/compiled-typechain";
import { BigNumberish, constants } from "ethers";
import { commify, formatEther } from "ethers/lib/utils";
import { ethers, network } from "hardhat";
import {
  CompositeOracle,
  OffChainOracle,
  ChainlinkOracle,
  OffChainOracle__factory,
  CompositeOracle__factory,
} from "../../typechain/v8";
import { withNetworkFile, getConfig } from "../../utils";

type IOracles = OffChainOracle | CompositeOracle | ChainlinkOracle;

interface IGetOraclePriceParam {
  NAME: string;
  ORACLE: IOracles;
  ORACLE_DATA: string;
}

type IGetOraclePriceParams = Array<IGetOraclePriceParam>;

function isOffChainOracle(oracle: IOracles): oracle is OffChainOracle {
  return (oracle as OffChainOracle).store !== undefined;
}

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
  const PARAMS: IGetOraclePriceParams = [
    {
      NAME: "LatteV2-BUSD - USD Composite Oracle",
      ORACLE: CompositeOracle__factory.connect("0x554F4Ed695D801B2c2cceC0a9927977C264A50fb", deployer),
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0xDa01147B87d389d1BDB3c2dD28bf56c79BE74E3c"]),
    },
    {
      NAME: "USDT - BUSD Composite Oracle",
      ORACLE: CompositeOracle__factory.connect("0x554F4Ed695D801B2c2cceC0a9927977C264A50fb", deployer),
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(["address"], ["0xf180466bBbaD8883360334309f558842e4B6eE59"]),
    },
  ];

  for (const param of PARAMS) {
    const { NAME, ORACLE, ORACLE_DATA } = param;
    console.log(`=============${`Oracle: ${NAME}`}===========`);
    const oraclePrice = await ORACLE.get(ORACLE_DATA);
    console.log(`Oracle Price: ${commify(formatEther(oraclePrice[1]))}`);
    console.log(`Is Stale (idle > 1 day): ${!oraclePrice[0]}`);

    if (isOffChainOracle(ORACLE)) {
      const decoded = ethers.utils.defaultAbiCoder.decode(["address", "address"], ORACLE_DATA);
      const result = await ORACLE.store(decoded[0], decoded[1]);
      console.log(`OffChain Oracle Last Update: ${result.lastUpdate}`);
    }
    console.log("============================================");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
