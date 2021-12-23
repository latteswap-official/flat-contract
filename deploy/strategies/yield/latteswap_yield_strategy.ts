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
      STAKING_TOKEN: "0x318B894003D0EAcfEDaA41B8c70ed3CE1Fde1450",
      CLERK: config.Clerk,
      TREASURY_ACCOUNT: "0xC29d5eB3d4baBa9b23753B00b8F048ec0431E358",
      TREASURY_FEE_BPS: "700",
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

      console.log(`>> grant role strategy caller to CLERK`);
      tx = await latteSwapYieldStrategy.grantRole(await latteSwapYieldStrategy.STRATEGY_CALLER_ROLE(), param.CLERK, {
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        nonce: nonce++,
      });
      console.log(`✅ Done grant role strategy caller to CLERK ${tx.hash}`);

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
