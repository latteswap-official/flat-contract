import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { Clerk__factory, FLAT, FLAT__factory, LatteSwapYieldStrategy__factory } from "../../typechain/v8";
import { getConfig, IDevelopConfig, withNetworkFile } from "../../utils";
import { constants } from "ethers";
import { expect } from "chai";

const main = async () => {
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
  const LATTESWAP_YIELD_STRATEGY = "0x758A0C5C032285F004d514Cc1D5Ca155C7b9dbbE";
  const BOOSTER = config.Booster;
  const STAKING_TOKEN = "0xBD4284d34b9673FC79aAb2C0080C5A19b4282425";
  const CLERK = config.Clerk;
  const TREASURY_ACCOUNT = "0xC29d5eB3d4baBa9b23753B00b8F048ec0431E358";
  const TREASURY_FEE_BPS = "700";
  const STRATEGY_TARGET_BPS = "10000";

  const latteswapYieldStrategy = LatteSwapYieldStrategy__factory.connect(LATTESWAP_YIELD_STRATEGY, deployer);
  const clerk = Clerk__factory.connect(CLERK, deployer);

  console.log(">> latteswapYieldStrategy should already set Clerk as a strategy caller");
  expect(
    await latteswapYieldStrategy.hasRole(await latteswapYieldStrategy.STRATEGY_CALLER_ROLE(), CLERK),
    "should contain clerk as a strategy caller role"
  ).to.be.true;
  console.log(">> ✅ DONE");

  console.log(">> latteswapYieldStrategy should has a correct treasury account and treasury fee bps");
  expect(await latteswapYieldStrategy.treasuryAccount(), "should contain the treasury account").to.equal(
    TREASURY_ACCOUNT
  );
  expect(await latteswapYieldStrategy.treasuryFeeBps(), "should contain the treasury fee bps").to.equal(
    TREASURY_FEE_BPS
  );
  console.log(">> ✅ DONE");

  console.log(">> latteswapYieldStrategy should has a correct booster");
  expect(await latteswapYieldStrategy.latteBooster(), "should be equal to a booster").to.equal(BOOSTER);
  console.log(">> ✅ DONE");

  console.log(">> latteswapYieldStrategy should use LATTEv2 as a reward token");
  expect(await latteswapYieldStrategy.rewardToken(), "should be equal to a LATTEv2").to.equal(config.Tokens.LATTEV2);
  console.log(">> ✅ DONE");

  console.log(">> Clerk should contain latteswapYieldStrategy as a strategy for the current staking token");
  expect(await clerk.strategy(STAKING_TOKEN)).to.equal(LATTESWAP_YIELD_STRATEGY);
  console.log(">> ✅ DONE");

  console.log(">> strategy target bps should be 10000");
  expect((await clerk.strategyData(STAKING_TOKEN)).targetBps).to.equal(STRATEGY_TARGET_BPS);
  console.log(">> ✅ DONE");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
