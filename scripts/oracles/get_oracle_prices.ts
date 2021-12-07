import { Timelock__factory } from "@latteswap/latteswap-contract/compiled-typechain";
import { BigNumberish, constants } from "ethers";
import { commify, formatEther } from "ethers/lib/utils";
import { ethers, network } from "hardhat";
import { CompositeOracle, OffChainOracle, ChainlinkOracle, OffChainOracle__factory } from "../../typechain/v8";
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
      NAME: "LatteV2-BUSD - USD OffChain Oracle",
      ORACLE: OffChainOracle__factory.connect("0x8474BE3314EDD429993B4948f3c5059F124139E8", deployer),
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        ["0x1524C3380257eF5D556AFeB6056c35DeFA9db8b6", constants.AddressZero]
      ),
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
