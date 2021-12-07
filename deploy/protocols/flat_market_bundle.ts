import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import {
  FlatMarketConfig,
  FlatMarketConfig__factory,
  FlatMarket,
  FlatMarket__factory,
  TreasuryHolder,
  TreasuryHolder__factory,
  Clerk,
  Clerk__factory,
} from "../../typechain/v8";
import { withNetworkFile } from "../../utils";
import { constants } from "ethers";

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
  let nonce = await deployer.getTransactionCount();
  const FLAT_MARKET_CONFIG = "0xC1A51315bE43D84FA7C8b6Dc038799fE1F89ef81";
  const PARAMS = [
    {
      // market params
      CLERK: "0x140616edc7A9262788AB5c4D43a013D970de295B",
      FLAT: "0x0950F9553e02B0d0cCb1Eb76E71B7Abf7E3AB7c2",
      COLLATERAL_TOKEN: "0xf180466bBbaD8883360334309f558842e4B6eE59",
      ORACLE: "0x8474BE3314EDD429993B4948f3c5059F124139E8",
      ORACLE_DATA: ethers.utils.defaultAbiCoder.encode(
        ["address", "address"],
        ["0xf180466bBbaD8883360334309f558842e4B6eE59", constants.AddressZero]
      ),
      // config params
      COLLATERAL_FACTOR: "9000",
      LIQUIDATION_PENALTY: "10500",
      LIQUIDATION_TREASURY_BPS: "500",
      MIN_DEBT_SIZE: "1000",
      INTEREST_PER_SECOND: "317097920",
    },
  ];

  await withNetworkFile(async () => {
    let tx;
    const flatMarketConfig = FlatMarketConfig__factory.connect(FLAT_MARKET_CONFIG, deployer);
    const markets = [];

    for (const PARAM of PARAMS) {
      console.log(`>> deploying an FlatMarket`);
      const FlatMarket = (await ethers.getContractFactory("FlatMarket", deployer)) as FlatMarket__factory;
      const flatMarket = (await upgrades.deployProxy(FlatMarket, [
        PARAM.CLERK,
        PARAM.FLAT,
        PARAM.COLLATERAL_TOKEN,
        FLAT_MARKET_CONFIG,
        PARAM.ORACLE,
        PARAM.ORACLE_DATA,
      ])) as FlatMarket;
      nonce++;

      await flatMarket.deployed();
      console.log(`>> Deployed at ${flatMarket.address}`);
      console.log("✅ Done deploying FlatMarket");

      const clerk = Clerk__factory.connect(PARAM.CLERK, deployer);

      console.log(`>> whitelist market ${flatMarket.address} in CLERK`);
      tx = await clerk.whitelistMarket(flatMarket.address, true, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(`✅ Done at tx ${tx.hash}`);

      markets.push(flatMarket.address);
    }

    console.log(`>> set config in the config`);
    tx = await flatMarketConfig.setConfig(
      markets,
      PARAMS.map((p) => ({
        collateralFactor: p.COLLATERAL_FACTOR,
        liquidationPenalty: p.LIQUIDATION_PENALTY,
        liquidationTreasuryBps: p.LIQUIDATION_TREASURY_BPS,
        minDebtSize: p.MIN_DEBT_SIZE,
        interestPerSecond: p.INTEREST_PER_SECOND,
      })),
      { gasPrice: ethers.utils.parseUnits("20", "gwei"), nonce: nonce++ }
    );
    console.log(`✅ Done at tx ${tx.hash}`);
  });
};

export default func;
func.tags = ["DeployFlatMarketBundle"];
