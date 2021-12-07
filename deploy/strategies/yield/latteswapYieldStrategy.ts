import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { Clerk__factory, LatteSwapYieldStrategy, LatteSwapYieldStrategy__factory } from "../../../typechain/v8";
import { getConfig, withNetworkFile } from "../../../utils";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";

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
  const BOOSTER = config.Booster;
  const STAKING_TOKEN = "0xf180466bBbaD8883360334309f558842e4B6eE59";
  const CLERK = "0x140616edc7A9262788AB5c4D43a013D970de295B";
  const TREASURY_ACCOUNT = await deployer.getAddress();
  const TREASURY_FEE_BPS = "1000";
  const STRATEGY_TARGET_BPS = "10000";

  await withNetworkFile(async () => {
    let tx;
    console.log(`deploying a LatteSwap Yield Strategy`);

    const LatteSwapYieldStrategy = (await ethers.getContractFactory(
      "LatteSwapYieldStrategy",
      deployer
    )) as LatteSwapYieldStrategy__factory;
    const latteSwapYieldStrategy = (await upgrades.deployProxy(LatteSwapYieldStrategy, [
      BOOSTER,
      STAKING_TOKEN,
    ])) as LatteSwapYieldStrategy;

    await latteSwapYieldStrategy.deployed();
    console.log(`>> Deployed at ${latteSwapYieldStrategy.address}`);
    console.log("✅ Done deploying a LatteSwap Yield Strategy");

    let nonce = await deployer.getTransactionCount();

    const clerk = Clerk__factory.connect(CLERK, deployer);

    console.log(`>> grant role governance to CLERK`);
    tx = await latteSwapYieldStrategy.grantRole(await latteSwapYieldStrategy.GOVERNANCE_ROLE(), CLERK, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done grant role governance to CLERK ${tx.hash}`);

    console.log(`>> set treasury account to latte yield strategy`);
    tx = await latteSwapYieldStrategy.setTreasuryAccount(TREASURY_ACCOUNT, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done setting a treasury account to latte yield strategy ${tx.hash}`);

    console.log(`>> set treasury fee bps to latte yield strategy`);
    tx = await latteSwapYieldStrategy.setTreasuryFeeBps(TREASURY_FEE_BPS, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done setting treasury fee bps to latte yield strategy ${tx.hash}`);

    console.log(`>> set strategy for staking token ${STAKING_TOKEN} for clerk`);
    tx = await clerk.setStrategy(STAKING_TOKEN, latteSwapYieldStrategy.address, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done setting treasury fee bps to latte yield strategy ${tx.hash}`);

    console.log(
      `>> set a strategy target bps for staking token ${STAKING_TOKEN} to be ${STRATEGY_TARGET_BPS} for clerk`
    );
    tx = await clerk.setStrategyTargetBps(STAKING_TOKEN, STRATEGY_TARGET_BPS, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(
      `✅ Done setting a strategy target bps for staking token ${STAKING_TOKEN} to be ${STRATEGY_TARGET_BPS} for clerk`
    );
  });
};

export default func;
func.tags = ["DeployLatteSwapYieldStrategy"];
