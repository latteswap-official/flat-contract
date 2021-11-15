import { ethers, upgrades, waffle } from "hardhat";
import { BigNumber, Signer, constants, BigNumberish } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { FlatMarketConfig, FlatMarketConfig__factory } from "../../typechain/v8";

chai.use(solidity);
const { expect } = chai;

describe("FlatMarketConfig", () => {
  // Accounts
  let deployer: Signer;
  let alice: Signer;

  let deployerAddress: string;
  let aliceAddress: string;

  // FlatMarketConfig contract
  let flatMarketConfig: FlatMarketConfig;

  // Contact instance with Signer
  let flatMarketConfigAsAlice: FlatMarketConfig;

  async function fixture() {
    [deployer, alice] = await ethers.getSigners();
    [deployerAddress, aliceAddress] = await Promise.all([deployer.getAddress(), alice.getAddress()]);

    // Deploy MarketConfig
    const FlatMarketConfig = (await ethers.getContractFactory(
      "FlatMarketConfig",
      deployer
    )) as FlatMarketConfig__factory;
    flatMarketConfig = (await upgrades.deployProxy(FlatMarketConfig, [deployerAddress])) as FlatMarketConfig;

    // Connect contract with Signer
    flatMarketConfigAsAlice = FlatMarketConfig__factory.connect(flatMarketConfig.address, alice);
  }

  beforeEach(async () => {
    await waffle.loadFixture(fixture);
  });

  describe("#initialzied", async () => {
    it("should be initialized correctly", async () => {
      expect(await flatMarketConfig.treasury()).to.equal(deployerAddress);
    });
  });

  describe("#setConfig", async () => {
    context("when owner uses setConfig", async () => {
      context("when flat market address not valid", async () => {
        it("should revert", async () => {
          await expect(
            flatMarketConfig.setConfig(
              [constants.AddressZero],
              [
                {
                  collateralFactor: 9500,
                  liquidationPenalty: 10500,
                  liquidationTreasuryBps: 1000,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad market");
        });
      });

      context("when collateral factor not valid", async () => {
        it("should revert", async () => {
          await expect(
            flatMarketConfig.setConfig(
              [aliceAddress],
              [
                {
                  collateralFactor: 0,
                  liquidationPenalty: 10500,
                  liquidationTreasuryBps: 1000,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad collateralFactor");

          await expect(
            flatMarketConfig.setConfig(
              [aliceAddress],
              [
                {
                  collateralFactor: 10000,
                  liquidationPenalty: 10500,
                  liquidationTreasuryBps: 1000,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad collateralFactor");
        });
      });

      context("when liquidity penalty not valid", async () => {
        it("should revert", async () => {
          await expect(
            flatMarketConfig.setConfig(
              [aliceAddress],
              [
                {
                  collateralFactor: 8500,
                  liquidationPenalty: 9000,
                  liquidationTreasuryBps: 1000,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad liquidityPenalty");

          await expect(
            flatMarketConfig.setConfig(
              [aliceAddress],
              [
                {
                  collateralFactor: 8500,
                  liquidationPenalty: 19900,
                  liquidationTreasuryBps: 1000,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad liquidityPenalty");
        });
      });

      context("when liquidity treasury bps not valid", async () => {
        it("should revert", async () => {
          await expect(
            flatMarketConfig.setConfig(
              [aliceAddress],
              [
                {
                  collateralFactor: 8500,
                  liquidationPenalty: 10500,
                  liquidationTreasuryBps: 300,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad liquidationTreasuryBps");

          await expect(
            flatMarketConfig.setConfig(
              [aliceAddress],
              [
                {
                  collateralFactor: 8500,
                  liquidationPenalty: 10500,
                  liquidationTreasuryBps: 10000,
                  minDebtSize: ethers.utils.parseEther("1"),
                  interestPerSecond: 1,
                },
              ]
            )
          ).to.be.revertedWith("bad liquidationTreasuryBps");
        });
      });

      context("when everything alright", async () => {
        it("should work", async () => {
          await flatMarketConfig.setConfig(
            [aliceAddress],
            [
              {
                collateralFactor: 8500,
                liquidationPenalty: 10500,
                liquidationTreasuryBps: 1000,
                minDebtSize: ethers.utils.parseEther("1"),
                interestPerSecond: 1,
              },
            ]
          );

          expect(await flatMarketConfig.collateralFactor(aliceAddress, deployerAddress)).to.equal(8500);
          expect(await flatMarketConfig.liquidationPenalty(aliceAddress)).to.equal(10500);
          expect(await flatMarketConfig.liquidationTreasuryBps(aliceAddress)).to.equal(1000);
          expect(await flatMarketConfig.minDebtSize(aliceAddress)).to.equal(ethers.utils.parseEther("1"));
          expect(await flatMarketConfig.interestPerSecond(aliceAddress)).to.equal(1);
        });
      });
    });

    context("when Alice uses setConfig", async () => {
      it("should revert", async () => {
        await expect(
          flatMarketConfigAsAlice.setConfig(
            [aliceAddress],
            [
              {
                collateralFactor: 8500,
                liquidationPenalty: 10500,
                liquidationTreasuryBps: 1000,
                minDebtSize: ethers.utils.parseEther("1"),
                interestPerSecond: 1,
              },
            ]
          )
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });
  });

  describe("#setTreasury", async () => {
    context("when owner uses setTreasury", async () => {
      context("when _newTreasury is address(0)", async () => {
        it("should revert", async () => {
          await expect(flatMarketConfig.setTreasury(constants.AddressZero)).to.be.revertedWith("bad _newTreasury");
        });
      });

      context("when address is ok", async () => {
        it("should work", async () => {
          await flatMarketConfig.setTreasury(aliceAddress);
          expect(await flatMarketConfig.treasury()).to.equal(aliceAddress);
        });
      });
    });

    context("when Alice uses setTreasury", async () => {
      it("should revert", async () => {
        await expect(flatMarketConfigAsAlice.setTreasury(aliceAddress)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
    });
  });
});
