import { ethers, waffle } from "hardhat";
import { BigNumber, Signer, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { latteSwapYieldStrategyUnitTestFixture } from "../helpers";
import {
  LatteSwapYieldStrategy,
  LatteSwapYieldStrategy__factory,
  MockBoosterForLatteSwapYield,
  MockMasterBaristaForLatteSwapYield,
  SimpleToken,
  SimpleToken__factory,
} from "../../typechain/v8";
import {
  BeanBag,
  Booster,
  LATTE,
  MockWBNB,
  WNativeRelayer,
  MasterBarista,
} from "@latteswap/latteswap-contract/compiled-typechain";
import { MockContract } from "@defi-wonderland/smock";
import { latestBlockNumber } from "../helpers/time";

chai.use(solidity);
const { expect } = chai;

describe("LatteSwapYieldStrategy", () => {
  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let treasury: Signer;
  let dev: Signer;

  // Contract bindings
  let LATTE_START_BLOCK: number;
  let LATTE_PER_BLOCK: BigNumber;
  let booster: MockContract;
  let masterBarista: MockContract;
  let stakingToken: SimpleToken;
  let latteToken: LATTE;
  let wbnb: MockWBNB;
  let wNativeRelayer: WNativeRelayer;
  let latteSwapPoolStrategy: LatteSwapYieldStrategy;

  // User
  let latteSwapPoolStrategyAsAlice: LatteSwapYieldStrategy;

  beforeEach(async () => {
    ({
      LATTE_PER_BLOCK,
      LATTE_START_BLOCK,
      booster,
      masterBarista,
      stakingToken,
      latteToken,
      wbnb,
      wNativeRelayer,
      latteSwapPoolStrategy,
    } = await waffle.loadFixture(latteSwapYieldStrategyUnitTestFixture));
    [deployer, alice, treasury, dev] = await ethers.getSigners();

    latteSwapPoolStrategyAsAlice = LatteSwapYieldStrategy__factory.connect(latteSwapPoolStrategy.address, alice);
  });

  context("#deposit()", () => {
    context("with some rewards to be harvest", () => {
      it("should successfully stake to MasterBarista with reward debt", async () => {
        const ownerAddress = await alice.getAddress();
        await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK master barista storages so that it can harvest
        await masterBarista.setVariable("userInfo", {
          [stakingToken.address]: {
            [latteSwapPoolStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
              fundedBy: booster.address,
            },
          },
        });

        // mock return
        await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
          ethers.utils.parseEther("168")
        );
        // Mint some staking token to owner
        await stakingToken.mint(ownerAddress, ethers.utils.parseEther("100"));
        await SimpleToken__factory.connect(stakingToken.address, alice).transfer(
          latteSwapPoolStrategy.address,
          ethers.utils.parseEther("100")
        );
        await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());
        await latteSwapPoolStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [constants.Zero, ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
          )
        );
        expect(
          await latteSwapPoolStrategy.accRewardBalance(),
          "accRewardBalance() should be 168 since currently user share is 0"
        ).to.eq(ethers.utils.parseEther("168"));
        expect(
          await latteSwapPoolStrategy.accRewardPerShare(),
          "accRewardPerShare() should be 168[from harvest]/100[total share] = 1.68 LATTE"
        ).to.eq(ethers.utils.parseUnits("1.68", 27));

        await latteSwapPoolStrategyAsAlice.deposit(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [
              ethers.utils.parseEther("100"),
              ownerAddress,
              ethers.utils.parseEther("200"),
              ethers.utils.parseEther("100"),
            ]
          )
        );
        expect(
          await latteSwapPoolStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 168 LATTE since we just skim the reward"
        ).to.eq(ethers.utils.parseEther("168"));

        // mock return
        await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
          ethers.utils.parseEther("200")
        );

        await latteSwapPoolStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [
              ethers.utils.parseEther("100"),
              ownerAddress,
              ethers.utils.parseEther("200"),
              ethers.utils.parseEther("100"),
            ]
          )
        );

        expect(
          await latteSwapPoolStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 168 (firsted harvest) + 100 (second harvest) = 268 LATTE"
        ).to.eq(ethers.utils.parseEther("268"));

        expect(await latteToken.balanceOf(ownerAddress), "100 LATTE (from 200) should be sent back to the user").to.eq(
          ethers.utils.parseEther("100")
        );
        expect(
          await latteSwapPoolStrategy.accRewardBalance(),
          "accRewardBalance should be 268 from 168 [first harvest] + 100 [second harvest] LATTE"
        ).to.eq(ethers.utils.parseEther("268"));
      });
    });

    context("without rewards to be harvested", () => {
      it("should successfully stake to MasterBarista", async () => {
        const ownerAddress = await alice.getAddress();
        await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK master barista storages so that it can harvest
        await masterBarista.setVariable("userInfo", {
          [stakingToken.address]: {
            [latteSwapPoolStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
              fundedBy: booster.address,
            },
          },
        });

        // Mint some staking token to owner
        await stakingToken.mint(ownerAddress, ethers.utils.parseEther("100"));
        await SimpleToken__factory.connect(stakingToken.address, alice).transfer(
          latteSwapPoolStrategy.address,
          ethers.utils.parseEther("100")
        );
        await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());
        await latteSwapPoolStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [constants.Zero, ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
          )
        );
        expect(
          await latteSwapPoolStrategy.accRewardBalance(),
          "accRewardBalance should be 0 since there is no reward"
        ).to.eq(ethers.utils.parseEther("0"));
        expect(
          await latteSwapPoolStrategy.accRewardPerShare(),
          "accRewardPerShare should be 0 since there is no reward"
        ).to.eq(ethers.utils.parseEther("0"));

        await latteSwapPoolStrategyAsAlice.deposit(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [
              ethers.utils.parseEther("100"),
              ownerAddress,
              ethers.utils.parseEther("200"),
              ethers.utils.parseEther("100"),
            ]
          )
        );
        expect(await latteSwapPoolStrategy.rewardDebts(ownerAddress), "reward debt should be 0").to.eq(
          ethers.utils.parseEther("0")
        );

        // mock stake reward return
        await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
          ethers.utils.parseEther("200")
        );

        await latteSwapPoolStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [
              ethers.utils.parseEther("100"),
              ownerAddress,
              ethers.utils.parseEther("200"),
              ethers.utils.parseEther("100"),
            ]
          )
        );

        expect(
          await latteSwapPoolStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 100 LATTE since the user just harvest the 100 LATTE"
        ).to.eq(ethers.utils.parseEther("100"));

        expect(await latteToken.balanceOf(ownerAddress)).to.eq(ethers.utils.parseEther("100"));
        expect(
          await latteSwapPoolStrategy.accRewardBalance(),
          "accRewardBalance should be 100 since 100 from 200 was sent to the user"
        ).to.eq(ethers.utils.parseEther("100"));
      });
    });
  });

  context("#withdraw()", () => {
    context("with some rewards to be harvest", () => {
      it("should be able to withdraw the reward", async () => {
        // mock master barista reward for stakingToken
        const ownerAddress = await alice.getAddress();
        await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK master barista storages
        await masterBarista.setVariable("userInfo", {
          [stakingToken.address]: {
            [latteSwapPoolStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
              fundedBy: booster.address,
            },
          },
        });

        // mock return
        await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
          ethers.utils.parseEther("168")
        );

        // Mint some staking token to owner
        await stakingToken.mint(booster.address, ethers.utils.parseEther("10"));

        await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());
        await latteSwapPoolStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [
              ethers.utils.parseEther("100"),
              ownerAddress,
              ethers.utils.parseEther("200"),
              ethers.utils.parseEther("100"),
            ]
          )
        );

        expect(
          await latteSwapPoolStrategy.accRewardBalance(),
          "accRewardBalance should be (168/200) * 100  = 84"
        ).to.eq(ethers.utils.parseEther("84"));
        expect(await latteSwapPoolStrategy.accRewardPerShare(), "168/200 = 0.84").to.eq(
          ethers.utils.parseUnits("0.84", 27)
        );
        expect(await latteToken.balanceOf(ownerAddress), "84 LATTE should be sent back to the user").to.eq(
          ethers.utils.parseEther("84")
        );
        expect(
          await latteToken.balanceOf(latteSwapPoolStrategy.address),
          "84 LATTE should be remain in the strategy"
        ).to.eq(ethers.utils.parseEther("84"));

        await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
          ethers.utils.parseEther("200")
        );

        await latteSwapPoolStrategyAsAlice.withdraw(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [ethers.utils.parseEther("10"), ownerAddress, ethers.utils.parseEther("200"), ethers.utils.parseEther("90")]
          )
        );
        expect(await stakingToken.balanceOf(ownerAddress), "caller should get 10 staking token back").to.eq(
          ethers.utils.parseEther("10")
        );
        expect(
          await latteToken.balanceOf(latteSwapPoolStrategy.address),
          "284 LATTE should be remain in the strategy"
        ).to.eq(ethers.utils.parseEther("284"));
        expect(
          await latteSwapPoolStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 90 * 0.84 = 75.6 LATTE"
        ).to.eq(ethers.utils.parseEther("75.6"));
      });
    });
    context("without rewards to be harvested", () => {
      it("should successfully withdraw the reward", async () => {
        // mock master barista reward for stakingToken
        const ownerAddress = await alice.getAddress();
        await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK master barista storages
        await masterBarista.setVariable("userInfo", {
          [stakingToken.address]: {
            [latteSwapPoolStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
              fundedBy: booster.address,
            },
          },
        });

        // Mint some staking token to owner
        await stakingToken.mint(booster.address, ethers.utils.parseEther("10"));

        await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());
        await latteSwapPoolStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [
              ethers.utils.parseEther("100"),
              ownerAddress,
              ethers.utils.parseEther("200"),
              ethers.utils.parseEther("100"),
            ]
          )
        );

        expect(await latteSwapPoolStrategy.accRewardBalance(), "accRewardBalance should be 0").to.eq(
          ethers.utils.parseEther("0")
        );
        expect(await latteSwapPoolStrategy.accRewardPerShare(), "0").to.eq(constants.Zero);
        expect(await latteToken.balanceOf(ownerAddress), "0 LATTE should be sent back to the user").to.eq(
          ethers.utils.parseEther("0")
        );

        await latteSwapPoolStrategyAsAlice.withdraw(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [ethers.utils.parseEther("10"), ownerAddress, ethers.utils.parseEther("200"), ethers.utils.parseEther("90")]
          )
        );
        expect(await stakingToken.balanceOf(ownerAddress), "the user should get 10 staking token back").to.eq(
          ethers.utils.parseEther("10")
        );
        expect(await latteSwapPoolStrategy.rewardDebts(ownerAddress), "rewardDebt should be 0 (no reward)").to.eq(
          ethers.utils.parseEther("0")
        );
      });
    });
  });

  context("#harvest()", () => {
    context("when there is no stake balance", () => {
      context("when there are some rewards before", () => {
        it("should not return any reward with a correct accRewardBalance", async () => {
          // mock master barista reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK master barista storages
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });
          await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());

          // pretend that there are total of 8888 hatvested rewards
          await latteToken.transfer(latteSwapPoolStrategy.address, ethers.utils.parseEther("8888"));

          await latteSwapPoolStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
            )
          );

          expect(await latteSwapPoolStrategy.accRewardBalance(), "accRewardBalance should be 8888").to.eq(
            ethers.utils.parseEther("8888")
          );
          expect(
            await latteSwapPoolStrategy.accRewardPerShare(),
            "accRewardBalance should be 8888/100 = 88.88 LATTE"
          ).to.eq(ethers.utils.parseUnits("88.88", 27));
          expect(await latteToken.balanceOf(ownerAddress), "0 latte token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );

          expect(
            await latteSwapPoolStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 0"
          ).to.eq(ethers.utils.parseEther("0"));
        });
      });

      context("when there is no reward before ", () => {
        it("should not return any reward with a correct accRewardBalance", async () => {
          // mock master barista reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK master barista storages
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });
          await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());

          await latteSwapPoolStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
            )
          );

          expect(await latteSwapPoolStrategy.accRewardBalance(), "accRewardBalance should be 0").to.eq(
            ethers.utils.parseEther("0")
          );
          expect(await latteSwapPoolStrategy.accRewardPerShare(), "accRewardBalance should be 0").to.eq(constants.Zero);
          expect(await latteToken.balanceOf(ownerAddress), "0 LATTE token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );

          expect(
            await latteSwapPoolStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 0"
          ).to.eq(ethers.utils.parseEther("0"));
        });
      });
    });

    context("when there is no total share", () => {
      context("when there are some rewards before", () => {
        it("should not return any reward", async () => {
          // mock master barista reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK master barista storages
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });

          await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());
          await latteToken.transfer(latteSwapPoolStrategy.address, ethers.utils.parseEther("8888"));

          await latteSwapPoolStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("0"), ethers.utils.parseEther("0")]
            )
          );

          expect(await latteSwapPoolStrategy.accRewardBalance(), "accReward balance should be 8888").to.eq(
            ethers.utils.parseEther("8888")
          );
          expect(await latteSwapPoolStrategy.accRewardPerShare(), "0").to.eq(constants.Zero);
          expect(await latteToken.balanceOf(ownerAddress), "0 LATTE token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );
        });
      });
      context("when there is no reward before ", () => {
        it("should not return any reward", async () => {
          // mock master barista reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK master barista storages
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });

          await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());
          await latteSwapPoolStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("0"), ethers.utils.parseEther("0")]
            )
          );

          expect(await latteSwapPoolStrategy.accRewardBalance(), "accRewardBalance should be 0").to.eq(
            ethers.utils.parseEther("0")
          );
          expect(await latteSwapPoolStrategy.accRewardPerShare(), "0").to.eq(constants.Zero);
          expect(await latteToken.balanceOf(ownerAddress), "0 LATTE token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );
        });
      });
    });

    context("happy", () => {
      context("when there are some rewards before", () => {
        it("should be able to harvest the reward along with calculate a correct reward debt", async () => {
          // mock master barista reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK master barista storages so that it can harvest
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("10").toString(),
                fundedBy: booster.address,
              },
            },
          });

          await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());

          // pretend that there are total of 8888 hatvested rewards
          await latteToken.transfer(latteSwapPoolStrategy.address, ethers.utils.parseEther("8888"));

          // mock pending rewards
          await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
            ethers.utils.parseEther("200")
          );

          await latteSwapPoolStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [
                ethers.utils.parseEther("100"),
                ownerAddress,
                ethers.utils.parseEther("200"),
                ethers.utils.parseEther("100"),
              ]
            )
          );

          expect(await latteSwapPoolStrategy.accRewardBalance(), "accRewardBalance should be 4544").to.eq(
            ethers.utils.parseEther("4544")
          );
          expect(
            await latteSwapPoolStrategy.accRewardPerShare(),
            "accRewardBalance should be 9088/200 = 45.44 LATTE"
          ).to.eq(ethers.utils.parseUnits("45.44", 27));
          expect(await latteToken.balanceOf(ownerAddress), "4544 latte token should be sent back to the user").to.eq(
            ethers.utils.parseEther("4544")
          );

          expect(
            await latteSwapPoolStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 4544"
          ).to.eq(ethers.utils.parseEther("4544"));
        });
      });

      context("when there is no reward before", () => {
        it("should be able to harvest the reward along with calculate a correct reward debt", async () => {
          // mock master barista reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await latteSwapPoolStrategy.grantRole(await latteSwapPoolStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK master barista storages so that it can harvest
          await masterBarista.setVariable("userInfo", {
            [stakingToken.address]: {
              [latteSwapPoolStrategy.address]: {
                amount: ethers.utils.parseEther("10").toString(),
                fundedBy: booster.address,
              },
            },
          });

          await latteSwapPoolStrategy.setTreasuryAccount(await treasury.getAddress());

          // mock pending rewards
          await (booster as unknown as MockBoosterForLatteSwapYield).setStakeRewardReturned(
            ethers.utils.parseEther("200")
          );

          await latteSwapPoolStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [
                ethers.utils.parseEther("100"),
                ownerAddress,
                ethers.utils.parseEther("200"),
                ethers.utils.parseEther("100"),
              ]
            )
          );

          expect(await latteSwapPoolStrategy.accRewardBalance(), "accRewardBalance should be 100").to.eq(
            ethers.utils.parseEther("100")
          );
          expect(await latteSwapPoolStrategy.accRewardPerShare(), "accRewardBalance should be 200/200 = 1 LATTE").to.eq(
            ethers.utils.parseUnits("1", 27)
          );
          expect(await latteToken.balanceOf(ownerAddress), "4544 latte token should be sent back to the user").to.eq(
            ethers.utils.parseEther("100")
          );

          expect(
            await latteSwapPoolStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 100 LATTE"
          ).to.eq(ethers.utils.parseEther("100"));
        });
      });
    });
  });
});
