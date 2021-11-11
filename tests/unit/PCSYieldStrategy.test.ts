import { ethers, waffle } from "hardhat";
import { BigNumber, Signer, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { pcsYieldStrategyUnitTestFixture } from "../helpers";
import {
  PCSYieldStrategy,
  SimpleToken,
  SimpleToken__factory,
  PCSYieldStrategy__factory,
  MockPCSMasterchef,
} from "../../typechain/v8";
import { MockContract } from "@defi-wonderland/smock";

chai.use(solidity);
const { expect } = chai;

describe("PCSYieldStrategy", () => {
  let PID: number;
  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let treasury: Signer;
  let dev: Signer;

  // Contract bindings
  let stakingToken: SimpleToken;
  let cake: SimpleToken;
  let pcsYieldStrategy: PCSYieldStrategy;
  let masterchef: MockContract;

  // User
  let pcsYieldStrategyAsAlice: PCSYieldStrategy;

  beforeEach(async () => {
    ({ stakingToken, cake, pcsYieldStrategy, masterchef, PID } = await waffle.loadFixture(
      pcsYieldStrategyUnitTestFixture
    ));
    [deployer, alice, treasury, dev] = await ethers.getSigners();

    pcsYieldStrategyAsAlice = PCSYieldStrategy__factory.connect(pcsYieldStrategy.address, alice);
  });

  context("#deposit()", () => {
    context("with some rewards to be harvest", () => {
      it("should successfully stake to MasterChef with reward debt", async () => {
        const ownerAddress = await alice.getAddress();
        await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK masterchef storages so that it can harvest
        await masterchef.setVariable("userInfo", {
          [PID]: {
            [pcsYieldStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
            },
          },
        });

        // mock return
        await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("168"));
        // Mint some staking token to owner
        await stakingToken.mint(ownerAddress, ethers.utils.parseEther("100"));
        await SimpleToken__factory.connect(stakingToken.address, alice).transfer(
          pcsYieldStrategy.address,
          ethers.utils.parseEther("100")
        );
        await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());
        await pcsYieldStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [constants.Zero, ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
          )
        );
        expect(
          await pcsYieldStrategy.accRewardBalance(),
          "accRewardBalance() should be 168 since currently user share is 0"
        ).to.eq(ethers.utils.parseEther("168"));
        expect(
          await pcsYieldStrategy.accRewardPerShare(),
          "accRewardPerShare() should be 168[from harvest]/100[total share] = 1.68 CAKE"
        ).to.eq(ethers.utils.parseUnits("1.68", 27));

        await pcsYieldStrategyAsAlice.deposit(
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
          await pcsYieldStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 168 CAKE since we just skim the reward"
        ).to.eq(ethers.utils.parseEther("168"));

        // mock return
        await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("200"));

        await pcsYieldStrategyAsAlice.harvest(
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
          await pcsYieldStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 168 (firsted harvest) + 100 (second harvest) = 268 CAKE"
        ).to.eq(ethers.utils.parseEther("268"));

        expect(await cake.balanceOf(ownerAddress), "100 CAKE (from 200) should be sent back to the user").to.eq(
          ethers.utils.parseEther("100")
        );
        expect(
          await pcsYieldStrategy.accRewardBalance(),
          "accRewardBalance should be 268 from 168 [first harvest] + 100 [second harvest] CAKE"
        ).to.eq(ethers.utils.parseEther("268"));
      });
    });

    context("without rewards to be harvested", () => {
      it("should successfully stake to MasterChef", async () => {
        const ownerAddress = await alice.getAddress();
        await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK masterchef storages so that it can harvest
        await masterchef.setVariable("userInfo", {
          [PID]: {
            [pcsYieldStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
            },
          },
        });

        // Mint some staking token to owner
        await stakingToken.mint(ownerAddress, ethers.utils.parseEther("100"));
        await SimpleToken__factory.connect(stakingToken.address, alice).transfer(
          pcsYieldStrategy.address,
          ethers.utils.parseEther("100")
        );
        await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());
        await pcsYieldStrategyAsAlice.harvest(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [constants.Zero, ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
          )
        );
        expect(
          await pcsYieldStrategy.accRewardBalance(),
          "accRewardBalance should be 0 since there is no reward"
        ).to.eq(ethers.utils.parseEther("0"));
        expect(
          await pcsYieldStrategy.accRewardPerShare(),
          "accRewardPerShare should be 0 since there is no reward"
        ).to.eq(ethers.utils.parseEther("0"));

        await pcsYieldStrategyAsAlice.deposit(
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
        expect(await pcsYieldStrategy.rewardDebts(ownerAddress), "reward debt should be 0").to.eq(
          ethers.utils.parseEther("0")
        );

        // mock stake reward return
        await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("200"));

        await pcsYieldStrategyAsAlice.harvest(
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
          await pcsYieldStrategy.rewardDebts(ownerAddress),
          "rewardDebt should be 100 CAKE since the user just harvest the 100 CAKE"
        ).to.eq(ethers.utils.parseEther("100"));

        expect(await cake.balanceOf(ownerAddress)).to.eq(ethers.utils.parseEther("100"));
        expect(
          await pcsYieldStrategy.accRewardBalance(),
          "accRewardBalance should be 100 since 100 from 200 was sent to the user"
        ).to.eq(ethers.utils.parseEther("100"));
      });
    });
  });

  context("#withdraw()", () => {
    context("with some rewards to be harvest", () => {
      it("should be able to withdraw the reward", async () => {
        // mock masterchef reward for stakingToken
        const ownerAddress = await alice.getAddress();
        await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK masterchef storages
        await masterchef.setVariable("userInfo", {
          [PID]: {
            [pcsYieldStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
            },
          },
        });

        // mock return
        await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("168"));

        // Mint some staking token to owner
        await stakingToken.mint(masterchef.address, ethers.utils.parseEther("10"));

        await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());
        await pcsYieldStrategyAsAlice.harvest(
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

        expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be (168/200) * 100  = 84").to.eq(
          ethers.utils.parseEther("84")
        );
        expect(await pcsYieldStrategy.accRewardPerShare(), "168/200 = 0.84").to.eq(ethers.utils.parseUnits("0.84", 27));
        expect(await cake.balanceOf(ownerAddress), "84 CAKE should be sent back to the user").to.eq(
          ethers.utils.parseEther("84")
        );
        expect(await cake.balanceOf(pcsYieldStrategy.address), "84 CAKE should be remain in the strategy").to.eq(
          ethers.utils.parseEther("84")
        );

        await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("200"));

        await pcsYieldStrategyAsAlice.withdraw(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [ethers.utils.parseEther("10"), ownerAddress, ethers.utils.parseEther("200"), ethers.utils.parseEther("90")]
          )
        );
        expect(await stakingToken.balanceOf(ownerAddress), "caller should get 10 staking token back").to.eq(
          ethers.utils.parseEther("10")
        );
        expect(await cake.balanceOf(pcsYieldStrategy.address), "284 CAKE should be remain in the strategy").to.eq(
          ethers.utils.parseEther("284")
        );
        expect(await pcsYieldStrategy.rewardDebts(ownerAddress), "rewardDebt should be 90 * 0.84 = 75.6 CAKE").to.eq(
          ethers.utils.parseEther("75.6")
        );
      });
    });
    context("without rewards to be harvested", () => {
      it("should successfully withdraw the reward", async () => {
        // mock masterchef reward for stakingToken
        const ownerAddress = await alice.getAddress();
        await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

        // MOCK masterchef storages
        await masterchef.setVariable("userInfo", {
          [PID]: {
            [pcsYieldStrategy.address]: {
              amount: ethers.utils.parseEther("10").toString(),
            },
          },
        });

        // Mint some staking token to owner
        await stakingToken.mint(masterchef.address, ethers.utils.parseEther("10"));

        await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());
        await pcsYieldStrategyAsAlice.harvest(
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

        expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be 0").to.eq(
          ethers.utils.parseEther("0")
        );
        expect(await pcsYieldStrategy.accRewardPerShare(), "0").to.eq(constants.Zero);
        expect(await cake.balanceOf(ownerAddress), "0 CAKE should be sent back to the user").to.eq(
          ethers.utils.parseEther("0")
        );

        await pcsYieldStrategyAsAlice.withdraw(
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256"],
            [ethers.utils.parseEther("10"), ownerAddress, ethers.utils.parseEther("200"), ethers.utils.parseEther("90")]
          )
        );
        expect(await stakingToken.balanceOf(ownerAddress), "the user should get 10 staking token back").to.eq(
          ethers.utils.parseEther("10")
        );
        expect(await pcsYieldStrategy.rewardDebts(ownerAddress), "rewardDebt should be 0 (no reward)").to.eq(
          ethers.utils.parseEther("0")
        );
      });
    });
  });

  context("#harvest()", () => {
    context("when there is no stake balance", () => {
      context("when there are some rewards before", () => {
        it("should not return any reward with a correct accRewardBalance", async () => {
          // mock masterchef reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK masterchef storages
          await masterchef.setVariable("userInfo", {
            [PID]: {
              [pcsYieldStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });
          await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());

          // pretend that there are total of 8888 hatvested rewards
          await cake.transfer(pcsYieldStrategy.address, ethers.utils.parseEther("8888"));

          await pcsYieldStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
            )
          );

          expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be 8888").to.eq(
            ethers.utils.parseEther("8888")
          );
          expect(await pcsYieldStrategy.accRewardPerShare(), "accRewardBalance should be 8888/100 = 88.88 CAKE").to.eq(
            ethers.utils.parseUnits("88.88", 27)
          );
          expect(await cake.balanceOf(ownerAddress), "0 CAKE should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );

          expect(
            await pcsYieldStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 0"
          ).to.eq(ethers.utils.parseEther("0"));
        });
      });

      context("when there is no reward before ", () => {
        it("should not return any reward with a correct accRewardBalance", async () => {
          // mock masterchef reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK masterchef storages
          await masterchef.setVariable("userInfo", {
            [PID]: {
              [pcsYieldStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });
          await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());

          await pcsYieldStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("100"), ethers.utils.parseEther("0")]
            )
          );

          expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be 0").to.eq(
            ethers.utils.parseEther("0")
          );
          expect(await pcsYieldStrategy.accRewardPerShare(), "accRewardBalance should be 0").to.eq(constants.Zero);
          expect(await cake.balanceOf(ownerAddress), "0 CAKE token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );

          expect(
            await pcsYieldStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 0"
          ).to.eq(ethers.utils.parseEther("0"));
        });
      });
    });

    context("when there is no total share", () => {
      context("when there are some rewards before", () => {
        it("should not return any reward", async () => {
          // mock masterchef reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK masterchef storages
          await masterchef.setVariable("userInfo", {
            [PID]: {
              [pcsYieldStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });

          await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());
          await cake.transfer(pcsYieldStrategy.address, ethers.utils.parseEther("8888"));

          await pcsYieldStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("0"), ethers.utils.parseEther("0")]
            )
          );

          expect(await pcsYieldStrategy.accRewardBalance(), "accReward balance should be 8888").to.eq(
            ethers.utils.parseEther("8888")
          );
          expect(await pcsYieldStrategy.accRewardPerShare(), "0").to.eq(constants.Zero);
          expect(await cake.balanceOf(ownerAddress), "0 CAKE token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );
        });
      });
      context("when there is no reward before ", () => {
        it("should not return any reward", async () => {
          // mock masterchef reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK masterchef storages
          await masterchef.setVariable("userInfo", {
            [PID]: {
              [pcsYieldStrategy.address]: {
                amount: ethers.utils.parseEther("0").toString(),
              },
            },
          });

          await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());
          await pcsYieldStrategyAsAlice.harvest(
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256"],
              [ethers.utils.parseEther("0"), ownerAddress, ethers.utils.parseEther("0"), ethers.utils.parseEther("0")]
            )
          );

          expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be 0").to.eq(
            ethers.utils.parseEther("0")
          );
          expect(await pcsYieldStrategy.accRewardPerShare(), "0").to.eq(constants.Zero);
          expect(await cake.balanceOf(ownerAddress), "0 CAKE token should be sent back to the user").to.eq(
            ethers.utils.parseEther("0")
          );
        });
      });
    });

    context("happy", () => {
      context("when there are some rewards before", () => {
        it("should be able to harvest the reward along with calculate a correct reward debt", async () => {
          // mock masterchef reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK masterchef storages so that it can harvest
          await masterchef.setVariable("userInfo", {
            [PID]: {
              [pcsYieldStrategy.address]: {
                amount: ethers.utils.parseEther("10").toString(),
              },
            },
          });

          await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());

          // pretend that there are total of 8888 hatvested rewards
          await cake.transfer(pcsYieldStrategy.address, ethers.utils.parseEther("8888"));

          // mock pending rewards
          await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("200"));

          await pcsYieldStrategyAsAlice.harvest(
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

          expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be 4544").to.eq(
            ethers.utils.parseEther("4544")
          );
          expect(await pcsYieldStrategy.accRewardPerShare(), "accRewardBalance should be 9088/200 = 45.44 CAKE").to.eq(
            ethers.utils.parseUnits("45.44", 27)
          );
          expect(await cake.balanceOf(ownerAddress), "4544 CAKE should be sent back to the user").to.eq(
            ethers.utils.parseEther("4544")
          );

          expect(
            await pcsYieldStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 4544"
          ).to.eq(ethers.utils.parseEther("4544"));
        });
      });

      context("when there is no reward before", () => {
        it("should be able to harvest the reward along with calculate a correct reward debt", async () => {
          // mock masterchef reward for stakingToken
          const ownerAddress = await alice.getAddress();
          await pcsYieldStrategy.grantRole(await pcsYieldStrategy.GOVERNANCE_ROLE(), ownerAddress);

          // MOCK masterchef storages so that it can harvest
          await masterchef.setVariable("userInfo", {
            [PID]: {
              [pcsYieldStrategy.address]: {
                amount: ethers.utils.parseEther("10").toString(),
              },
            },
          });

          await pcsYieldStrategy.setTreasuryAccount(await treasury.getAddress());

          // mock pending rewards
          await (masterchef as unknown as MockPCSMasterchef).setStakeRewardReturned(ethers.utils.parseEther("200"));

          await pcsYieldStrategyAsAlice.harvest(
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

          expect(await pcsYieldStrategy.accRewardBalance(), "accRewardBalance should be 100").to.eq(
            ethers.utils.parseEther("100")
          );
          expect(await pcsYieldStrategy.accRewardPerShare(), "accRewardBalance should be 200/200 = 1 CAKE").to.eq(
            ethers.utils.parseUnits("1", 27)
          );
          expect(await cake.balanceOf(ownerAddress), "4544 CAKE should be sent back to the user").to.eq(
            ethers.utils.parseEther("100")
          );

          expect(
            await pcsYieldStrategy.rewardDebts(ownerAddress),
            "rewardDebt should be for the user should be 100 CAKE"
          ).to.eq(ethers.utils.parseEther("100"));
        });
      });
    });
  });
});
