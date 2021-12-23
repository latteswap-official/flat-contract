import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { latteSwapLiquidationStrategyIntegrationTestFixture } from "../helpers";
import {
  Clerk,
  LatteSwapLiquidationStrategy,
  MockFlatMarketForLatteSwapLiquidationStrategy,
  SimpleToken,
} from "../../typechain/v8";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BaseContract, BigNumber } from "ethers";
import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";
import { LatteSwapFactory, LatteSwapPair, LatteSwapRouter } from "../../typechain/v6";
import { FakeContract, MockContract } from "@defi-wonderland/smock";

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
let flatMarket: MockFlatMarketForLatteSwapLiquidationStrategy;
let flatMarketConfig: FakeContract<BaseContract>;
let compositeOracle: FakeContract<BaseContract>;

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
      flatMarket,
      flatMarketConfig,
      compositeOracle,
    } = await waffle.loadFixture(latteSwapLiquidationStrategyIntegrationTestFixture));
  });

  describe("#execute()", () => {
    it("should be able to swap tokens", async () => {
      await clerk.whitelistMarket(flatMarket.address, true);
      // deployer deposit some money to clerk for liquidation strategy, making it able to swap
      const lpBalance = await lp.balanceOf(await deployer.getAddress());
      await lp.approve(clerk.address, lpBalance);
      await flatMarket.deposit(lp.address, latteSwapLiquidationStrategy.address, lpBalance);
      const removedBalanceT0 = reserve0.mul(lpBalance).div(await lp.totalSupply());
      const removedBalanceT1 = reserve1.mul(lpBalance).div(await lp.totalSupply());
      const token0FlatAmountOut = await router.getAmountOut(removedBalanceT0, reserve0, reserveFlat);
      const token1FlatAmountOut = await router.getAmountOut(removedBalanceT1, reserve1, reserveFlat);
      await expect(
        flatMarket.executeLiquidationStrategy(
          latteSwapLiquidationStrategy.address,
          await alice.getAddress(),
          token0FlatAmountOut.add(token1FlatAmountOut),
          lpBalance
        )
      ).to.reverted;
      await latteSwapLiquidationStrategy.setPathToFlat(token0.address, [token0.address, flat.address]);
      await latteSwapLiquidationStrategy.setPathToFlat(token1.address, [token1.address, flat.address]);
      await flatMarket.executeLiquidationStrategy(
        latteSwapLiquidationStrategy.address,
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
