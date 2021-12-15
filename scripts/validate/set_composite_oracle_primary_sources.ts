import { expect } from "chai";
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
  const PARAM: ISetCompositeOraclePrimarySourcesParam = {
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
