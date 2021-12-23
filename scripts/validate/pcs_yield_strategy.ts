import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { Clerk__factory, FLAT, FLAT__factory, PCSYieldStrategy__factory } from "../../typechain/v8";
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
  const PCS_YIELD_STRATEGY = "0xce4b067b319F449c998A91a5D1DebA5b74e968E3";
  const PCS_MASTERCHEF = "0x73feaa1eE314F8c655E354234017bE2193C9E24E";
  const STAKING_TOKEN = "0x7EFaEf62fDdCCa950418312c6C91Aef321375A00";
  const PID = "258";
  const CLERK = config.Clerk;
  const TREASURY_ACCOUNT = "0xC29d5eB3d4baBa9b23753B00b8F048ec0431E358";
  const TREASURY_FEE_BPS = "700";
  const STRATEGY_TARGET_BPS = "10000";

  const pcsYieldStrategy = PCSYieldStrategy__factory.connect(PCS_YIELD_STRATEGY, deployer);
  const clerk = Clerk__factory.connect(CLERK, deployer);

  console.log(">> pcsYieldStrategy should already set Clerk as a strategy caller");
  expect(
    await pcsYieldStrategy.hasRole(await pcsYieldStrategy.STRATEGY_CALLER_ROLE(), CLERK),
    "should contain clerk as a strategy caller role"
  ).to.be.true;
  console.log(">> ✅ DONE");

  console.log(">> pcsYieldStrategy should has a correct treasury account and treasury fee bps");
  expect(await pcsYieldStrategy.treasuryAccount(), "should contain the treasury account").to.equal(TREASURY_ACCOUNT);
  expect(await pcsYieldStrategy.treasuryFeeBps(), "should contain the treasury fee bps").to.equal(TREASURY_FEE_BPS);
  console.log(">> ✅ DONE");

  console.log(">> pcsYieldStrategy should use CAKE as a reward token");
  expect((await pcsYieldStrategy.rewardToken()).toLowerCase(), "should be equal to a CAKE").to.equal(
    config.Tokens.CAKE.toLowerCase()
  );
  console.log(">> ✅ DONE");

  console.log(">> pcsYieldStrategy should use PID of usdt busd");
  expect(await pcsYieldStrategy.pid(), "should use PID of usdt busd").to.equal(PID);
  console.log(">> ✅ DONE");

  console.log(">> pcsYieldStrategy should use pcs masterchef");
  expect(await pcsYieldStrategy.masterchef(), "should use pcs masterchef").to.equal(PCS_MASTERCHEF);
  console.log(">> ✅ DONE");

  console.log(">> Clerk should contain pcsYieldStrategy as a strategy for the current staking token");
  expect(await clerk.strategy(STAKING_TOKEN)).to.equal(PCS_YIELD_STRATEGY);
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
