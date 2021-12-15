import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { Clerk__factory, LatteSwapYieldStrategy, LatteSwapYieldStrategy__factory } from "../../../typechain/v8";
import { getConfig, withNetworkFile } from "../../../utils";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";

type ILatteSwapYieldStrategyParam = {
  BOOSTER: string;
  STAKING_TOKEN: string;
  CLERK: string;
  TREASURY_ACCOUNT: string;
  TREASURY_FEE_BPS: string;
  STRATEGY_TARGET_BPS: string;
};

type ILatteSwapYieldStrategyParams = Array<ILatteSwapYieldStrategyParam>;

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
  const config = getConfig();
  let nonce = await deployer.getTransactionCount();
  const PARAMS: ILatteSwapYieldStrategyParams = [
    {
      BOOSTER: config.Booster,
      STAKING_TOKEN: "0xDa01147B87d389d1BDB3c2dD28bf56c79BE74E3c",
      CLERK: "0x140616edc7A9262788AB5c4D43a013D970de295B",
      TREASURY_ACCOUNT: await deployer.getAddress(),
      TREASURY_FEE_BPS: "1000",
      STRATEGY_TARGET_BPS: "10000",
    },
    {
      BOOSTER: config.Booster,
      STAKING_TOKEN: "0xf180466bBbaD8883360334309f558842e4B6eE59",
      CLERK: "0x140616edc7A9262788AB5c4D43a013D970de295B",
      TREASURY_ACCOUNT: await deployer.getAddress(),
      TREASURY_FEE_BPS: "1000",
      STRATEGY_TARGET_BPS: "10000",
    },
  ];

  await withNetworkFile(async () => {
    let tx;
    for (const param of PARAMS) {
      console.log(`deploying a LatteSwap Yield Strategy`);

      const LatteSwapYieldStrategy = (await ethers.getContractFactory(
        "LatteSwapYieldStrategy",
        deployer
      )) as LatteSwapYieldStrategy__factory;
      const latteSwapYieldStrategy = (await upgrades.deployProxy(LatteSwapYieldStrategy, [
        param.BOOSTER,
        param.STAKING_TOKEN,
      ])) as LatteSwapYieldStrategy;

      await latteSwapYieldStrategy.deployed();
      console.log(`>> Deployed at ${latteSwapYieldStrategy.address}`);
      console.log("✅ Done deploying a LatteSwap Yield Strategy");

      nonce = await deployer.getTransactionCount();

      const clerk = Clerk__factory.connect(param.CLERK, deployer);

      console.log(`>> grant role governance to CLERK`);
      tx = await latteSwapYieldStrategy.grantRole(await latteSwapYieldStrategy.GOVERNANCE_ROLE(), param.CLERK, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(`✅ Done grant role governance to CLERK ${tx.hash}`);

      console.log(`>> set treasury account to latte yield strategy`);
      tx = await latteSwapYieldStrategy.setTreasuryAccount(param.TREASURY_ACCOUNT, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(`✅ Done setting a treasury account to latte yield strategy ${tx.hash}`);

      console.log(`>> set treasury fee bps to latte yield strategy`);
      tx = await latteSwapYieldStrategy.setTreasuryFeeBps(param.TREASURY_FEE_BPS, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(`✅ Done setting treasury fee bps to latte yield strategy ${tx.hash}`);

      console.log(`>> set strategy for staking token ${param.STAKING_TOKEN} for clerk`);
      tx = await clerk.setStrategy(param.STAKING_TOKEN, latteSwapYieldStrategy.address, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        gasLimit: 100000,
        nonce: nonce++,
      });
      console.log(`✅ Done setting strategy to latte yield strategy ${tx.hash}`);

      console.log(
        `>> set a strategy target bps for staking token ${param.STAKING_TOKEN} to be ${param.STRATEGY_TARGET_BPS} for clerk`
      );
      tx = await clerk.setStrategyTargetBps(param.STAKING_TOKEN, param.STRATEGY_TARGET_BPS, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(
        `✅ Done setting a strategy target bps for staking token ${param.STAKING_TOKEN} to be ${param.STRATEGY_TARGET_BPS} for clerk`
      );
    }
  });
};

export default func;
func.tags = ["DeployLatteSwapYieldStrategy"];
