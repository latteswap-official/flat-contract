import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades } from "hardhat";
import { Clerk__factory, PCSYieldStrategy, PCSYieldStrategy__factory } from "../../../typechain/v8";
import { getConfig, withNetworkFile } from "../../../utils";

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
  const PCS_MASTERCHEF = "0x73feaa1eE314F8c655E354234017bE2193C9E24E";
  const STAKING_TOKEN = "0xf45cd219aef8618a92baa7ad848364a158a24f33";
  const PID = "365";
  const CLERK = config.Clerk;
  const TREASURY_ACCOUNT = "0xC29d5eB3d4baBa9b23753B00b8F048ec0431E358";
  const TREASURY_FEE_BPS = "700";
  const STRATEGY_TARGET_BPS = "10000";

  await withNetworkFile(async () => {
    let tx;
    console.log(`deploying a PCS Yield Strategy`);

    const PCSYieldStrategy = (await ethers.getContractFactory(
      "PCSYieldStrategy",
      deployer
    )) as PCSYieldStrategy__factory;
    const pcsYieldStrategy = (await upgrades.deployProxy(PCSYieldStrategy, [
      PCS_MASTERCHEF,
      STAKING_TOKEN,
      PID,
    ])) as PCSYieldStrategy;

    await pcsYieldStrategy.deployed();
    console.log(`>> Deployed at ${pcsYieldStrategy.address}`);
    console.log("✅ Done deploying a PCS Yield Strategy");

    let nonce = await deployer.getTransactionCount();

    const clerk = Clerk__factory.connect(CLERK, deployer);

    console.log(`>> grant role strategy caller to CLERK`);
    tx = await pcsYieldStrategy.grantRole(await pcsYieldStrategy.STRATEGY_CALLER_ROLE(), CLERK, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done grant role strategy caller to CLERK ${tx.hash}`);

    console.log(`>> set treasury account to pcs yield strategy`);
    tx = await pcsYieldStrategy.setTreasuryAccount(TREASURY_ACCOUNT, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done setting a treasury account to pcs yield strategy ${tx.hash}`);

    console.log(`>> set treasury fee bps to pcs yield strategy`);
    tx = await pcsYieldStrategy.setTreasuryFeeBps(TREASURY_FEE_BPS, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done setting treasury fee bps to pcs yield strategy ${tx.hash}`);

    console.log(`>> set strategy for staking token ${STAKING_TOKEN} for clerk`);
    tx = await clerk.setStrategy(STAKING_TOKEN, pcsYieldStrategy.address, {
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      nonce: nonce++,
    });
    console.log(`✅ Done setting treasury fee bps to pcs yield strategy ${tx.hash}`);

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
func.tags = ["DeployPCSYieldStrategy"];
