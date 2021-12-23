import { BigNumberish, constants } from "ethers";
import { ethers, network } from "hardhat";
import { Clerk__factory, FlatMarket__factory, FLAT__factory } from "../../compiled-typechain/v8";
import { CompositeOracle__factory } from "../../typechain/v8";
import { withNetworkFile, getConfig, IDevelopConfig } from "../../utils";

interface IReplenishParam {
  SHOULD_REPLENISH: boolean;
  PARAM: Array<{
    MARKET: string;
    AMOUNT: BigNumberish;
  }>;
}

interface ISendParam {
  SHOULD_DIRECT_SEND: boolean;
  PARAM: Array<{
    MARKET: string;
    AMOUNT: BigNumberish;
  }>;
}

interface IMintParam {
  SHOULD_MINT: boolean;
  AMOUNT: BigNumberish;
}

interface IMintAndReplenishParam {
  MINT: IMintParam;
  REPLENISH: IReplenishParam;
  DIRECT_SEND: ISendParam;
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
  let nonce = await deployer.getTransactionCount();
  const config = getConfig();
  const PARAM: IMintAndReplenishParam = {
    MINT: {
      SHOULD_MINT: false,
      AMOUNT: ethers.utils.parseEther("100000000"),
    },
    REPLENISH: {
      SHOULD_REPLENISH: false,
      PARAM: [],
    },
    DIRECT_SEND: {
      SHOULD_DIRECT_SEND: true,
      PARAM: [
        {
          MARKET: (config as IDevelopConfig).FlatMarket["LATTEv2-BUSD"],
          AMOUNT: ethers.utils.parseEther("1000000"),
        },
        {
          MARKET: (config as IDevelopConfig).FlatMarket["USDT-BUSD"],
          AMOUNT: ethers.utils.parseEther("1000000"),
        },
        {
          MARKET: (config as IDevelopConfig).FlatMarket["PCS_CAKE-BNB"],
          AMOUNT: ethers.utils.parseEther("1000000"),
        },
      ],
    },
  };

  const flat = FLAT__factory.connect(config.FLAT, deployer);
  const clerk = Clerk__factory.connect(config.Clerk, deployer);
  let tx;
  let estimatedGas;

  if (PARAM.MINT.SHOULD_MINT) {
    console.log(">> Execute transaction for minting FLAT");
    estimatedGas = await flat.estimateGas.mint(flat.address, PARAM.MINT.AMOUNT);
    tx = await flat.mint(flat.address, PARAM.MINT.AMOUNT, {
      nonce: nonce++,
      gasPrice: ethers.utils.parseUnits("20", "gwei"),
      gasLimit: estimatedGas.add(100000),
    });
    console.log(`>> returned tx hash: ${tx.hash}`);
    console.log("✅ Done");
  }

  if (PARAM.REPLENISH.SHOULD_REPLENISH) {
    for (const replenish of PARAM.REPLENISH.PARAM) {
      console.log(">> Execute transaction for replenishing FLAT");
      estimatedGas = await flat.estimateGas.replenish(replenish.MARKET, replenish.AMOUNT, config.Clerk);
      tx = await flat.replenish(replenish.MARKET, replenish.AMOUNT, config.Clerk, {
        nonce: nonce++,
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        gasLimit: estimatedGas.add(100000),
      });
      console.log(`>> returned tx hash: ${tx.hash}`);
      console.log("✅ Done");
    }
  }

  if (PARAM.DIRECT_SEND.SHOULD_DIRECT_SEND) {
    for (const send of PARAM.DIRECT_SEND.PARAM) {
      console.log(">> Approve Flat for clerk");
      estimatedGas = await flat.estimateGas.approve(config.Clerk, send.AMOUNT);
      tx = await flat.approve(config.Clerk, send.AMOUNT, {
        nonce: nonce++,
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        gasLimit: estimatedGas.add(100000),
      });
      console.log(`>> returned tx hash: ${tx.hash}`);
      console.log("✅ Done");

      console.log(`>> Deposit FLAT to the market ${send.MARKET}`);
      estimatedGas = await clerk.estimateGas.deposit(
        config.FLAT,
        await deployer.getAddress(),
        send.MARKET,
        send.AMOUNT,
        0
      );
      tx = await clerk.deposit(config.FLAT, await deployer.getAddress(), send.MARKET, send.AMOUNT, 0, {
        nonce: nonce++,
        gasPrice: ethers.utils.parseUnits("20", "gwei"),
        gasLimit: estimatedGas.add(100000),
      });
      console.log(`>> returned tx hash: ${tx.hash}`);
      console.log("✅ Done");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
