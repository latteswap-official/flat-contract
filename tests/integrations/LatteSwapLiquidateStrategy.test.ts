import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { latteSwapLiquidationStrategyIntegrationTestFixture } from "../helpers";
import {
  Clerk,
  LatteSwapLiquidationStrategy,
  SimpleToken,
  LatteSwapFactory,
  LatteSwapPair,
  LatteSwapRouter,
} from "../../typechain/v8";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";

chai.use(solidity);
const { expect } = chai;

// constants
let reserve0: BigNumber;
let reserve1: BigNumber;
let reserveFlat: BigNumber;

// contract binding
let latteSwapLiquidationStrategy: LatteSwapLiquidationStrategy;
let clerk: Clerk;
let router: LatteSwapRouter;
let factory: LatteSwapFactory;
let token0: SimpleToken;
let token1: SimpleToken;
let flat: SimpleToken;
let lp: LatteSwapPair;
let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("LatteSwapLiquidateStrategy", () => {
  beforeEach(async () => {
    [, alice, bob] = await ethers.getSigners();
    ({
      latteSwapLiquidationStrategy,
      clerk,
      router,
      factory,
      token0,
      token1,
      flat,
      deployer,
      reserve0,
      reserve1,
      lp,
      reserveFlat,
    } = await waffle.loadFixture(latteSwapLiquidationStrategyIntegrationTestFixture));
  });

  describe("#execute()", () => {
    it("should be able to swap tokens", async () => {
      // deployer deposit some money to clerk for liquidation strategy, making it able to swap
      const lpBalance = await lp.balanceOf(await deployer.getAddress());

      await lp.approve(clerk.address, lpBalance);

      await clerk.deposit(lp.address, await deployer.getAddress(), latteSwapLiquidationStrategy.address, lpBalance, 0);

      const removedBalanceT0 = reserve0.mul(lpBalance).div(await lp.totalSupply());
      const removedBalanceT1 = reserve1.mul(lpBalance).div(await lp.totalSupply());

      const token0FlatAmountOut = await router.getAmountOut(removedBalanceT0, reserve0, reserveFlat);
      const token1FlatAmountOut = await router.getAmountOut(removedBalanceT1, reserve1, reserveFlat);

      await expect(
        latteSwapLiquidationStrategy.execute(
          lp.address,
          flat.address,
          await alice.getAddress(),
          token0FlatAmountOut.add(token1FlatAmountOut),
          lpBalance
        )
      ).to.reverted;

      await latteSwapLiquidationStrategy.setPathToFlat(token0.address, [token0.address, flat.address]);
      await latteSwapLiquidationStrategy.setPathToFlat(token1.address, [token1.address, flat.address]);
      await latteSwapLiquidationStrategy.execute(
        lp.address,
        flat.address,
        await alice.getAddress(),
        token0FlatAmountOut.add(token1FlatAmountOut),
        lpBalance
      );
      expect(await clerk.balanceOf(lp.address, await alice.getAddress())).to.eq(0);
      expect(await clerk.balanceOf(lp.address, await deployer.getAddress())).to.eq(0);
      expect(await clerk.balanceOf(flat.address, await alice.getAddress())).to.eq(
        token0FlatAmountOut.add(token1FlatAmountOut)
      );
      expect(await clerk.balanceOf(flat.address, await deployer.getAddress())).to.eq(0);
    });
  });
});
