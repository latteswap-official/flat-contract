import { BigNumberish, constants } from "ethers";
import { ethers, network } from "hardhat";
import { CompositeOracle__factory } from "../../typechain/v8";
import { withNetworkFile, getConfig } from "../../utils";

interface ISetCompositeOraclePrimarySourcesParam {
  TOKEN: string;
  MAX_DEVIATION: BigNumberish;
  ORACLE: Array<string>;
  ORACLE_DATA: Array<string>;
}

type ISetCompositeOraclePrimarySourcesParams = Array<ISetCompositeOraclePrimarySourcesParam>;

interface IMappedSetCompositeOraclePrimarySourcesParam {
  TOKENS: Array<string>;
  MAX_DEVIATIONS: Array<BigNumberish>;
  ORACLES: Array<Array<string>>;
  ORACLE_DATAS: Array<Array<string>>;
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
  const COMPOSITE_ORACLE = "0x554F4Ed695D801B2c2cceC0a9927977C264A50fb";
  const PARAMS: ISetCompositeOraclePrimarySourcesParams = [
    {
      TOKEN: "0x0eD7e52944161450477ee417DE9Cd3a859b14fD0",
      MAX_DEVIATION: ethers.utils.parseEther("1.5"),
      ORACLE: ["0x241c377eEC3e30F7581515d28C5DF7f308408ff7", "0x8474BE3314EDD429993B4948f3c5059F124139E8"],
      ORACLE_DATA: [
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "uint256"],
          ["0x09cF4972912282CE6ceca6150c98a046Cac2e600", constants.AddressZero, ethers.utils.parseUnits("1", 36)]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address"],
          ["0x0eD7e52944161450477ee417DE9Cd3a859b14fD0", constants.AddressZero]
        ),
      ],
    },
  ];

  const MAPPED_PARAMS: IMappedSetCompositeOraclePrimarySourcesParam = PARAMS.reduce(
    (accum, param) => {
      accum.TOKENS.push(param.TOKEN);
      accum.MAX_DEVIATIONS.push(param.MAX_DEVIATION);
      accum.ORACLES.push(param.ORACLE);
      accum.ORACLE_DATAS.push(param.ORACLE_DATA);
      return accum;
    },
    {
      TOKENS: [],
      MAX_DEVIATIONS: [],
      ORACLES: [],
      ORACLE_DATAS: [],
    } as IMappedSetCompositeOraclePrimarySourcesParam
  );

  const compositeOracle = CompositeOracle__factory.connect(COMPOSITE_ORACLE, deployer);

  console.log(`>> Execute tx to set multiple primary sources`);

  const tx = await compositeOracle.setMultiPrimarySources(
    MAPPED_PARAMS.TOKENS,
    MAPPED_PARAMS.MAX_DEVIATIONS,
    MAPPED_PARAMS.ORACLES,
    MAPPED_PARAMS.ORACLE_DATAS,
    {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
    }
  );

  console.log(`>> returned tx hash: ${tx.hash}`);
  console.log("✅ Done");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
