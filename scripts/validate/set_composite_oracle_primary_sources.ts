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
    TOKEN: "0xDa01147B87d389d1BDB3c2dD28bf56c79BE74E3c",
    MAX_DEVIATION: ethers.utils.parseEther("1.5"),
    ORACLE: ["0x8474BE3314EDD429993B4948f3c5059F124139E8"],
    ORACLE_DATA: [
      ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        ["0x1524C3380257eF5D556AFeB6056c35DeFA9db8b6", constants.AddressZero]
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
