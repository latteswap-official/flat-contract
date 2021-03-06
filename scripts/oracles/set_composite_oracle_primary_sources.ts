import { BigNumberish, constants } from "ethers";
import { ethers, network } from "hardhat";
import { CompositeOracle__factory } from "../../typechain/v8";
import { withNetworkFile, getConfig, IProdConfig } from "../../utils";

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
  const config = getConfig() as IProdConfig;
  const COMPOSITE_ORACLE = config.Oracle.Composite;
  const PARAMS: ISetCompositeOraclePrimarySourcesParams = [
    {
      TOKEN: "0xF45cd219aEF8618A92BAa7aD848364a158a24F33",
      MAX_DEVIATION: ethers.utils.parseEther("1.05"),
      ORACLE: [config.Oracle.Chainlink, config.Oracle.OffChain],
      ORACLE_DATA: [
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address", "uint256"],
          [config.ChainlinkAggregator["PCS_BTCB-BUSD"], constants.AddressZero, ethers.utils.parseUnits("1", 36)]
        ),
        ethers.utils.defaultAbiCoder.encode(
          ["address", "address"],
          ["0xF45cd219aEF8618A92BAa7aD848364a158a24F33", constants.AddressZero]
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
