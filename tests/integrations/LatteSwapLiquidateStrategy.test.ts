import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { latteSwapLiquidationStrategyIntegrationTestFixture } from "../helpers";
import { Clerk, LatteSwapLiquidationStrategy, SimpleToken } from "../../typechain/v8";
import { LatteSwapFactory, LatteSwapRouter } from "@latteswap/latteswap-contract/compiled-typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

chai.use(solidity);
const { expect } = chai;

// constants
let reserve0: BigNumber;
let reserve1: BigNumber;

// contract binding
let latteSwapLiquidationStrategy: LatteSwapLiquidationStrategy;
let clerk: Clerk;
let router: LatteSwapRouter;
let factory: LatteSwapFactory;
let token0: SimpleToken;
let token1: SimpleToken;
let deployer: SignerWithAddress;
let alice: SignerWithAddress;
let bob: SignerWithAddress;

describe("LatteSwapLiquidateStrategy", () => {
  beforeEach(async () => {
    [, alice, bob] = await ethers.getSigners();
    ({ latteSwapLiquidationStrategy, clerk, router, factory, token0, token1, deployer, reserve0, reserve1 } =
      await waffle.loadFixture(latteSwapLiquidationStrategyIntegrationTestFixture));
  });

  describe("#swap()", () => {
    context("with tokenIn = token0 and tokenOut = token1", () => {
      it("should be able to swap tokens", async () => {
        // deployer deposit some money to clerk for liquidation strategy, making it able to swap
        await token0.approve(clerk.address, ethers.utils.parseEther("100"));

        await clerk.deposit(
          token0.address,
          await deployer.getAddress(),
          latteSwapLiquidationStrategy.address,
          ethers.utils.parseEther("100"),
          0
        );
        const amountOut = await router.getAmountOut(ethers.utils.parseEther("100"), reserve0, reserve1);

        await latteSwapLiquidationStrategy.execute(
          token0.address,
          token1.address,
          await alice.getAddress(),
          amountOut,
          ethers.utils.parseEther("100")
        );

        expect(await clerk.balanceOf(token0.address, await alice.getAddress())).to.eq(0);
        expect(await clerk.balanceOf(token0.address, await deployer.getAddress())).to.eq(0);
        expect(await clerk.balanceOf(token1.address, await alice.getAddress())).to.eq(amountOut);
        expect(await clerk.balanceOf(token1.address, await deployer.getAddress())).to.eq(0);
      });
    });

    context("with tokenIn = token1 and tokenOut = token0", () => {
      it("should be able to swap tokens", async () => {
        // deployer deposit some money to clerk for liquidation strategy, making it able to swap
        await token1.approve(clerk.address, ethers.utils.parseEther("100"));

        await clerk.deposit(
          token1.address,
          await deployer.getAddress(),
          latteSwapLiquidationStrategy.address,
          ethers.utils.parseEther("100"),
          0
        );
        const amountOut = await router.getAmountOut(ethers.utils.parseEther("100"), reserve1, reserve0);

        await latteSwapLiquidationStrategy.execute(
          token1.address,
          token0.address,
          await alice.getAddress(),
          amountOut,
          ethers.utils.parseEther("100")
        );

        expect(await clerk.balanceOf(token1.address, await alice.getAddress())).to.eq(0);
        expect(await clerk.balanceOf(token1.address, await deployer.getAddress())).to.eq(0);
        expect(await clerk.balanceOf(token0.address, await alice.getAddress())).to.eq(amountOut);
        expect(await clerk.balanceOf(token0.address, await deployer.getAddress())).to.eq(0);
      });
    });
  });
});
