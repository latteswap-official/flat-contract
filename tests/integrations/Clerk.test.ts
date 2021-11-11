import { ethers, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { clerkIntegrationTestFixture } from "../helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Wallet } from "@ethersproject/wallet";
import {
  Clerk,
  Clerk__factory,
  LatteSwapYieldStrategy,
  MockBoosterForLatteSwapYield,
  MockEvilFlashLoaner,
  MockFlashLoaner,
  MockMasterBaristaForLatteSwapYield,
  SimpleToken,
  SimpleToken__factory,
} from "../../typechain/v8";
import { BigNumber, constants } from "ethers";
import { MockContract } from "@defi-wonderland/smock";
import { LATTE, MockWBNB } from "@latteswap/latteswap-contract/compiled-typechain";
import { duration, increaseTimestamp } from "../helpers/time";

chai.use(solidity);
const { expect } = chai;

describe("Clerk", () => {
  // Contract bindings
  let deployer: SignerWithAddress;
  let alice: Wallet;
  let bob: Wallet;
  let carol: SignerWithAddress;
  let wbnb: MockWBNB;
  let clerk: MockContract<Clerk>;
  let stakingToken: SimpleToken;
  let latteSwapPoolStrategy: LatteSwapYieldStrategy;
  let booster: MockContract<MockBoosterForLatteSwapYield>;
  let masterBarista: MockContract<MockMasterBaristaForLatteSwapYield>;
  let latteToken: LATTE;

  const extremeValidVolume = BigNumber.from(2).pow(127);
  const vaultProtocolLimit = BigNumber.from(2).pow(128).sub(1);
  const computationalLimit = constants.MaxUint256.sub(1);

  // contract as a user
  let clerkAsAlice: Clerk;
  let stakingToken0AsAlice: SimpleToken;

  beforeEach(async () => {
    ({
      deployer,
      alice,
      bob,
      funder: carol,
      wbnb,
      clerk,
      stakingToken,
      latteSwapPoolStrategy,
      booster,
      masterBarista,
      latteToken,
    } = await waffle.loadFixture(clerkIntegrationTestFixture));

    clerkAsAlice = Clerk__factory.connect(clerk.address, alice);
    stakingToken0AsAlice = SimpleToken__factory.connect(stakingToken.address, alice);
  });

  describe("Integrate with LatteSwapYieldStrategy", () => {
    describe("#deposit()", function () {
      context("with single staker", () => {
        it("should mutate the balance, transfer fund to MasterBarista, and harvest the reward", async function () {
          await stakingToken.connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1"));
          await expect(
            clerkAsAlice.deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          // MOCK master barista storages so that it can harvest
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("1").toString(),
                fundedBy: booster.address,
              },
            },
          });
          // mock pending rewards
          await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
            ethers.utils.parseEther("168")
          );
          await stakingToken.connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("2"));
          await expect(
            clerkAsAlice.deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("2"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("2"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("2"),
              ethers.utils.parseEther("2")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("3")
          );
          expect(await latteToken.balanceOf(alice.address), "alice should get her harvested rewards").to.be.equal(
            ethers.utils.parseEther("168")
          );
          expect(
            await stakingToken.balanceOf(booster.address),
            "mock booster should now contain a staking token"
          ).to.be.equal(ethers.utils.parseEther("3"));

          const stratData = await clerkAsAlice.strategyData(stakingToken.address);
          expect(stratData.balance, "strategy data should be 3").to.be.equal(ethers.utils.parseEther("3"));
          expect(await latteSwapPoolStrategy.rewardDebts(alice.address), "reward debts for alice should be 168").to.eq(
            ethers.utils.parseEther("168").mul(3)
          );
        });
      });

      context("with multiple stakers", () => {
        context("when strategy has been set after the first depositor", () => {
          it("should be able to collect all deposit balance to the strategy as well as distribute the correct reward", async () => {
            // set strategy to address 0 first
            await clerk.setStrategy(stakingToken.address, constants.AddressZero);
            await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("2"));
            await stakingToken.connect(bob).approve(clerk.address, ethers.utils.parseEther("1"));
            await stakingToken.mint(bob.address, ethers.utils.parseEther("2"));
            await expect(
              clerk
                .connect(alice)
                .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                alice.address,
                alice.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            await clerk.setStrategy(stakingToken.address, latteSwapPoolStrategy.address);
            await expect(
              clerk
                .connect(bob)
                .deposit(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(bob.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                bob.address,
                bob.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );

            // MOCK master barista storages so that it can harvest
            await masterBarista.setVariable("userInfo", {
              [stakingToken.address]: {
                [latteSwapPoolStrategy.address]: {
                  amount: ethers.utils.parseEther("2").toString(),
                  fundedBy: booster.address,
                },
              },
            });
            // mock pending rewards
            await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
              ethers.utils.parseEther("168")
            );
            await expect(
              clerk
                .connect(alice)
                .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                alice.address,
                alice.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );
            expect(await clerk.connect(alice).balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("2")
            );
            expect(await latteToken.balanceOf(alice.address), "alice should get his harvested rewards").to.be.equal(
              ethers.utils.parseEther("84")
            );
            expect(
              await stakingToken.balanceOf(booster.address),
              "mock booster should now contain a staking token"
            ).to.be.equal(ethers.utils.parseEther("3"));

            const stratData = await clerkAsAlice.strategyData(stakingToken.address);
            expect(stratData.balance, "strategy data should be 3").to.be.equal(ethers.utils.parseEther("3"));
            expect(await latteSwapPoolStrategy.rewardDebts(alice.address)).to.eq(ethers.utils.parseEther("84").mul(2));
          });
        });
        it("should mutate the balance, transfer fund to MasterBarista, and harvest the reward", async () => {
          await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("1"));
          await stakingToken.connect(bob).approve(clerk.address, ethers.utils.parseEther("2"));
          await stakingToken.mint(bob.address, ethers.utils.parseEther("2"));
          await expect(
            clerk
              .connect(alice)
              .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          await expect(
            clerk.connect(bob).deposit(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(bob.address, clerk.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              bob.address,
              bob.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, bob.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          // MOCK master barista storages so that it can harvest
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("2").toString(),
                fundedBy: booster.address,
              },
            },
          });
          // mock pending rewards
          await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
            ethers.utils.parseEther("168")
          );
          await expect(
            clerk.connect(bob).deposit(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(bob.address, clerk.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              bob.address,
              bob.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          expect(await clerk.connect(bob).balanceOf(stakingToken.address, bob.address)).to.be.equal(
            ethers.utils.parseEther("2")
          );
          expect(await latteToken.balanceOf(bob.address), "bob should get his harvested rewards").to.be.equal(
            ethers.utils.parseEther("84")
          );
          expect(
            await stakingToken.balanceOf(booster.address),
            "mock booster should now contain a staking token"
          ).to.be.equal(ethers.utils.parseEther("3"));

          const stratData = await clerkAsAlice.strategyData(stakingToken.address);
          expect(stratData.balance, "strategy data should be 3").to.be.equal(ethers.utils.parseEther("3"));
          expect(await latteSwapPoolStrategy.rewardDebts(bob.address)).to.eq(ethers.utils.parseEther("84").mul(2));
        });
      });
    });

    describe("#withdraw()", function () {
      context("with single staker", () => {
        context("when strategy has been set after the first depositor", () => {
          context("deposit value = 1", () => {
            it("should let the first depositor withdraw without any reversion or rewards gain", async () => {
              // set strategy to address 0 first
              await clerk.setStrategy(stakingToken.address, constants.AddressZero);
              await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("1"));
              await expect(
                clerk
                  .connect(alice)
                  .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
              )
                .to.emit(stakingToken, "Transfer")
                .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
                .to.emit(clerk, "LogDeposit")
                .withArgs(
                  stakingToken.address,
                  alice.address,
                  alice.address,
                  ethers.utils.parseEther("1"),
                  ethers.utils.parseEther("1")
                );
              await clerk.setStrategy(stakingToken.address, latteSwapPoolStrategy.address);

              await masterBarista.setVariable("userInfo", {
                [stakingToken.address]: {
                  [latteSwapPoolStrategy.address]: {
                    amount: ethers.utils.parseEther("1").toString(),
                    fundedBy: booster.address,
                  },
                },
              });

              await clerk
                .connect(alice)
                .withdraw(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0);
              expect((await clerkAsAlice.strategyData(stakingToken.address)).balance).to.eq(constants.Zero);
              expect(await clerk.connect(alice).balanceOf(stakingToken.address, alice.address)).to.eq(0);
              expect(await stakingToken.balanceOf(booster.address)).to.eq(ethers.utils.parseEther("0"));
            });
          });
          context("deposit value > 1 and withdraw value = 1", () => {
            it("should let the first depositor withdraw without any reversion or rewards gain", async () => {
              // set strategy to address 0 first
              await clerk.setStrategy(stakingToken.address, constants.AddressZero);
              await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("2"));
              await expect(
                clerk
                  .connect(alice)
                  .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("2"), 0)
              )
                .to.emit(stakingToken, "Transfer")
                .withArgs(alice.address, clerk.address, ethers.utils.parseEther("2"))
                .to.emit(clerk, "LogDeposit")
                .withArgs(
                  stakingToken.address,
                  alice.address,
                  alice.address,
                  ethers.utils.parseEther("2"),
                  ethers.utils.parseEther("2")
                );
              await clerk.setStrategy(stakingToken.address, latteSwapPoolStrategy.address);

              await masterBarista.setVariable("userInfo", {
                [stakingToken.address]: {
                  [latteSwapPoolStrategy.address]: {
                    amount: ethers.utils.parseEther("2").toString(),
                    fundedBy: booster.address,
                  },
                },
              });

              await clerk
                .connect(alice)
                .withdraw(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0);
              expect((await clerkAsAlice.strategyData(stakingToken.address)).balance).to.eq(
                ethers.utils.parseEther("1")
              );
              expect(await clerk.connect(alice).balanceOf(stakingToken.address, alice.address)).to.eq(
                ethers.utils.parseEther("1")
              );
            });
          });
        });
        it("should mutate the balance, transfer fund back to the user (bob), and harvest the reward", async function () {
          await stakingToken.connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1"));
          await expect(
            clerkAsAlice.deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          // MOCK master barista storages so that it can harvest
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("1").toString(),
                fundedBy: booster.address,
              },
            },
          });
          // mock pending rewards
          await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
            ethers.utils.parseEther("168")
          );
          await expect(
            clerkAsAlice.withdraw(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(clerk.address, alice.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogWithdraw")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("0")
          );
          expect(await latteToken.balanceOf(alice.address), "alice should get her harvested rewards").to.be.equal(
            ethers.utils.parseEther("168")
          );
          expect(
            await stakingToken.balanceOf(booster.address),
            "mock booster should now send a balance back to alice"
          ).to.be.equal(ethers.utils.parseEther("0"));

          const stratData = await clerkAsAlice.strategyData(stakingToken.address);
          expect(stratData.balance, "strategy data should be 0").to.be.equal(ethers.utils.parseEther("0"));
          expect(await latteSwapPoolStrategy.rewardDebts(alice.address), "reward debts for alice should be 168").to.eq(
            ethers.utils.parseEther("0")
          );
        });
      });

      context("with multiple stakers", () => {
        context("when strategy has been set after the first depositor", () => {
          it("should be able to collect all deposit balance to the strategy as well as distribute the correct reward", async () => {
            // set strategy to address 0 first
            await clerk.setStrategy(stakingToken.address, constants.AddressZero);
            await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("1"));
            await stakingToken.connect(bob).approve(clerk.address, ethers.utils.parseEther("1"));
            await stakingToken.mint(bob.address, ethers.utils.parseEther("1"));
            await expect(
              clerk
                .connect(alice)
                .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                alice.address,
                alice.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            await clerk.setStrategy(stakingToken.address, latteSwapPoolStrategy.address);
            await expect(
              clerk
                .connect(bob)
                .deposit(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(bob.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                bob.address,
                bob.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );

            // MOCK master barista storages so that it can harvest
            await masterBarista.setVariable("userInfo", {
              [stakingToken.address]: {
                [latteSwapPoolStrategy.address]: {
                  amount: ethers.utils.parseEther("2").toString(),
                  fundedBy: booster.address,
                },
              },
            });
            // mock pending rewards
            await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
              ethers.utils.parseEther("168")
            );
            await expect(
              clerk
                .connect(alice)
                .withdraw(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(clerk.address, alice.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogWithdraw")
              .withArgs(
                stakingToken.address,
                alice.address,
                alice.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("0")
            );
            expect(await clerk.connect(bob).balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );
            expect(await latteToken.balanceOf(alice.address), "alice should get her harvested rewards").to.be.equal(
              ethers.utils.parseEther("84")
            );
            expect(
              await stakingToken.balanceOf(booster.address),
              "mock booster should now contain a staking token"
            ).to.be.equal(ethers.utils.parseEther("1"));

            let stratData = await clerkAsAlice.strategyData(stakingToken.address);
            expect(stratData.balance, "strategy data should be 1").to.be.equal(ethers.utils.parseEther("1"));
            expect(await latteSwapPoolStrategy.rewardDebts(alice.address)).to.eq(0);

            await expect(
              clerk
                .connect(bob)
                .withdraw(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(clerk.address, bob.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogWithdraw")
              .withArgs(
                stakingToken.address,
                bob.address,
                bob.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );

            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("0")
            );
            expect(await clerk.connect(bob).balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("0")
            );
            expect(await latteToken.balanceOf(bob.address), "bob should get his harvested rewards").to.be.equal(
              ethers.utils.parseEther("84")
            );
            expect(
              await stakingToken.balanceOf(booster.address),
              "mock booster should now contain a staking token"
            ).to.be.equal(ethers.utils.parseEther("0"));

            stratData = await clerkAsAlice.strategyData(stakingToken.address);
            expect(stratData.balance, "strategy data should be 0").to.be.equal(ethers.utils.parseEther("0"));
            expect(await latteSwapPoolStrategy.rewardDebts(alice.address)).to.eq(0);
          });
        });

        context("when strategy has been set after the second depositor", () => {
          it("should be able to collect all deposit balance to the strategy as well as distribute the correct reward", async () => {
            // set strategy to address 0 first
            await clerk.setStrategy(stakingToken.address, constants.AddressZero);
            await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("1"));
            await stakingToken.connect(bob).approve(clerk.address, ethers.utils.parseEther("1"));
            await stakingToken.mint(bob.address, ethers.utils.parseEther("1"));
            await expect(
              clerk
                .connect(alice)
                .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                alice.address,
                alice.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            await expect(
              clerk
                .connect(bob)
                .deposit(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(bob.address, clerk.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogDeposit")
              .withArgs(
                stakingToken.address,
                bob.address,
                bob.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );

            await clerk.setStrategy(stakingToken.address, latteSwapPoolStrategy.address);
            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );

            // MOCK master barista storages so that it can harvest
            await masterBarista.setVariable("userInfo", {
              [stakingToken.address]: {
                [latteSwapPoolStrategy.address]: {
                  amount: ethers.utils.parseEther("2").toString(),
                  fundedBy: booster.address,
                },
              },
            });
            // mock pending rewards
            await expect(
              clerk
                .connect(alice)
                .withdraw(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(clerk.address, alice.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogWithdraw")
              .withArgs(
                stakingToken.address,
                alice.address,
                alice.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );
            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("0")
            );
            expect(await clerk.connect(bob).balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("1")
            );
            expect(
              await stakingToken.balanceOf(booster.address),
              "mock booster should now contain a staking token"
            ).to.be.equal(ethers.utils.parseEther("1"));

            let stratData = await clerkAsAlice.strategyData(stakingToken.address);
            expect(stratData.balance, "strategy data should be 1").to.be.equal(ethers.utils.parseEther("1"));
            expect(await latteSwapPoolStrategy.rewardDebts(alice.address)).to.eq(0);

            await expect(
              clerk
                .connect(bob)
                .withdraw(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
            )
              .to.emit(stakingToken, "Transfer")
              .withArgs(clerk.address, bob.address, ethers.utils.parseEther("1"))
              .to.emit(clerk, "LogWithdraw")
              .withArgs(
                stakingToken.address,
                bob.address,
                bob.address,
                ethers.utils.parseEther("1"),
                ethers.utils.parseEther("1")
              );

            expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
              ethers.utils.parseEther("0")
            );
            expect(await clerk.connect(bob).balanceOf(stakingToken.address, bob.address)).to.be.equal(
              ethers.utils.parseEther("0")
            );
            expect(
              await stakingToken.balanceOf(booster.address),
              "mock booster should now contain a staking token"
            ).to.be.equal(ethers.utils.parseEther("0"));

            stratData = await clerkAsAlice.strategyData(stakingToken.address);
            expect(stratData.balance, "strategy data should be 0").to.be.equal(ethers.utils.parseEther("0"));
            expect(await latteSwapPoolStrategy.rewardDebts(alice.address)).to.eq(0);
          });
        });
        it("should mutate the balance, transfer fund back to the user (bob), and harvest the reward without changing other users' state", async () => {
          await stakingToken.connect(alice).approve(clerk.address, ethers.utils.parseEther("1"));
          await stakingToken.connect(bob).approve(clerk.address, ethers.utils.parseEther("1"));
          await stakingToken.mint(bob.address, ethers.utils.parseEther("1"));
          await expect(
            clerk
              .connect(alice)
              .deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(alice.address, clerk.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          await expect(
            clerk.connect(bob).deposit(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(bob.address, clerk.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              bob.address,
              bob.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, bob.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          // MOCK master barista storages so that it can harvest
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("2").toString(),
                fundedBy: booster.address,
              },
            },
          });
          // mock pending rewards
          await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
            ethers.utils.parseEther("168")
          );
          await expect(
            clerk.connect(bob).withdraw(stakingToken.address, bob.address, bob.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(clerk.address, bob.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogWithdraw")
            .withArgs(
              stakingToken.address,
              bob.address,
              bob.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerk.balanceOf(stakingToken.address, alice.address)).to.be.equal(ethers.utils.parseEther("1"));
          expect(await clerk.balanceOf(stakingToken.address, bob.address)).to.be.equal(ethers.utils.parseEther("0"));
          expect(await stakingToken.balanceOf(bob.address)).to.eq(ethers.utils.parseEther("1"));
          expect(await latteToken.balanceOf(bob.address), "bob should get his harvested rewards").to.be.equal(
            ethers.utils.parseEther("84")
          );
          expect(
            await stakingToken.balanceOf(booster.address),
            "mock booster should now contain the only one staking token which is from alice"
          ).to.be.equal(ethers.utils.parseEther("1"));

          const stratData = await clerkAsAlice.strategyData(stakingToken.address);
          expect(stratData.balance, "strategy data should be 1").to.be.equal(ethers.utils.parseEther("1"));
          expect(await latteSwapPoolStrategy.rewardDebts(bob.address)).to.eq(0);
        });
      });
    });

    describe("#setStrategy()", function () {
      context("when there is a deposit in a previous strategy", () => {
        it("should emergency withdraw all deposit without considering any harvest money", async () => {
          await stakingToken.connect(alice).approve(clerkAsAlice.address, ethers.utils.parseEther("1"));
          await expect(
            clerkAsAlice.deposit(stakingToken.address, alice.address, alice.address, ethers.utils.parseEther("1"), 0)
          )
            .to.emit(stakingToken, "Transfer")
            .withArgs(alice.address, clerkAsAlice.address, ethers.utils.parseEther("1"))
            .to.emit(clerk, "LogDeposit")
            .withArgs(
              stakingToken.address,
              alice.address,
              alice.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1")
            );
          expect(await clerkAsAlice.balanceOf(stakingToken.address, alice.address)).to.be.equal(
            ethers.utils.parseEther("1")
          );
          expect(await stakingToken.balanceOf(booster.address)).to.eq(ethers.utils.parseEther("1"));
          await clerk.setStrategy(stakingToken.address, constants.AddressZero);
          expect(await stakingToken.balanceOf(booster.address)).to.eq(ethers.utils.parseEther("0"));
          expect(await stakingToken.balanceOf(clerk.address)).to.eq(ethers.utils.parseEther("1"));
          expect(await clerk.strategy(stakingToken.address)).to.eq(constants.AddressZero);
        });
      });
    });
  });
});
