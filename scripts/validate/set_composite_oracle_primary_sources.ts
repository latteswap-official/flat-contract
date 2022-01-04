import { expect } from "chai";
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
  const PARAM: ISetCompositeOraclePrimarySourcesParam = {
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
  };

  const compositeOracle = CompositeOracle__factory.connect(COMPOSITE_ORACLE, deployer);

  console.log(`>> max deviation should be ${PARAM.MAX_DEVIATION}`);
  expect(await compositeOracle.maxPriceDeviations(PARAM.TOKEN)).to.be.eq(PARAM.MAX_DEVIATION);
  console.log(">> ✅ pass");

  console.log(`>> oracle data and oracle should be correct`);
  for (const index in PARAM.ORACLE) {
    const source = await compositeOracle.primarySources(PARAM.TOKEN, index);
    const oracleData = await compositeOracle.oracleDatas(PARAM.TOKEN, index);
    expect(source).to.equal(PARAM.ORACLE[index]);
    expect(oracleData).to.equal(PARAM.ORACLE_DATA[index]);
  }
  console.log(">> ✅ pass");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
