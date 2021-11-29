import { ethers, waffle } from "hardhat";
import { BigNumber, constants } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { compositeOracleUnitTestFixture } from "../helpers";
import { CompositeOracle, LPChainlinkAggregator, MockOracle, SimpleToken } from "../../typechain/v8";
import { FakeContract } from "@defi-wonderland/smock";

chai.use(solidity);
const { expect } = chai;

describe("CompositeOracle", () => {
  // Contract bindings
  let compositeOracle: CompositeOracle;
  let simpleToken: SimpleToken;
  let mockOracles: Array<FakeContract<MockOracle>>;

  beforeEach(async () => {
    ({ compositeOracle, simpleToken, mockOracles } = await waffle.loadFixture(compositeOracleUnitTestFixture));
  });

  describe("#setPrimarySources()", () => {
    context("when bad max deviation value is given", () => {
      it("should revert", async () => {
        const maxDiviation = ethers.utils.parseUnits("0.1", 18);
        await expect(
          compositeOracle.setPrimarySources(
            simpleToken.address,
            maxDiviation,
            mockOracles.map((mockOracle) => mockOracle.address),
            mockOracles.map(() => [])
          )
        ).to.be.revertedWith("CompositeOracle::_setPrimarySources::bad max deviation value");
      });
    });

    context("when inconsistent length", () => {
      it("should revert", async () => {
        await expect(
          compositeOracle.setPrimarySources(
            simpleToken.address,
            constants.WeiPerEther,
            mockOracles.map((mockOracle) => mockOracle.address),
            []
          )
        ).to.be.revertedWith("CompositeOracle::_setPrimarySources::inconsistent length");
      });
    });

    context("when sources length exceeds 3", () => {
      it("should revert", async () => {
        await expect(
          compositeOracle.setPrimarySources(
            simpleToken.address,
            constants.WeiPerEther,
            mockOracles.map((mockOracle) => mockOracle.address),
            mockOracles.map(() => [])
          )
        ).to.be.revertedWith("CompositeOracle::_setPrimarySources::sources length exceed 3");
      });
    });

    context("when params are correct", () => {
      it("should successfully set primary sources with correct information", async () => {
        await compositeOracle.setPrimarySources(
          simpleToken.address,
          constants.WeiPerEther,
          mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
          mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
        );

        expect(await compositeOracle.primarySourceCount(simpleToken.address)).to.eq(3);

        for (const index in mockOracles.slice(0, 3)) {
          expect(await compositeOracle.oracleDatas(simpleToken.address, index)).to.eq(
            ethers.utils.defaultAbiCoder.encode(["uint256"], [index])
          );
          expect(await compositeOracle.primarySources(simpleToken.address, index)).to.eq(mockOracles[index].address);
        }
      });
    });
  });

  describe("#get()", () => {
    context("when there is no primary sources", () => {
      it("should revert", async () => {
        await expect(
          compositeOracle.get(ethers.utils.defaultAbiCoder.encode(["address"], [constants.AddressZero])),
          "should revert since no primary sources"
        ).to.be.revertedWith("CompositeOracle::_get::no primary source");
      });
    });

    context("when there is no valid source", () => {
      it("should revert", async () => {
        await compositeOracle.setPrimarySources(
          simpleToken.address,
          constants.WeiPerEther,
          [mockOracles[0].address, mockOracles[1].address],
          [[], []]
        );
        await mockOracles[0].get.reverts("something went wrong");
        await mockOracles[1].get.reverts("something went wrong");

        await expect(
          compositeOracle.get(ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address])),
          "should revert since no valid source"
        ).to.be.revertedWith("CompositeOracle::_get::no valid source");
      });
    });

    context("when params are correct", () => {
      context("when there is 1 primary source", () => {
        context("if that source is not stale (success = true)", () => {
          it("should be return the price", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              constants.WeiPerEther,
              mockOracles.slice(0, 1).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 1).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );
            const price = ethers.utils.parseEther("10");
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

            await mockOracles[0].get.returns([true, price]);

            const [_, expected] = await compositeOracle.get(encodedToken);
            expect(expected).to.eq(price);
          });
        });

        context("if that source is stale (success = false)", () => {
          it("should be return the price", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              constants.WeiPerEther,
              mockOracles.slice(0, 1).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 1).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );

            const price = ethers.utils.parseEther("10");
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

            await mockOracles[0].get.returns([false, price]);

            await expect(compositeOracle.get(encodedToken)).to.revertedWith("CompositeOracle::_get::no valid source");
          });
        });
      });
      context("when there are 2 primary sources", () => {
        context("when 2 prices for the sources have many deviation", () => {
          it("should revert", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              ethers.utils.parseUnits("1.2", 18), //20% dif
              mockOracles.slice(0, 2).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 2).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

            await mockOracles[0].get.returns([true, ethers.utils.parseEther("50")]);

            await mockOracles[1].get.returns([true, ethers.utils.parseEther("100")]); //50% diff with price0

            await expect(compositeOracle.get(encodedToken)).to.revertedWith(
              "CompositeOracle::_get::too much deviation (2 valid sources)"
            );
          });
        });
        it("should be return the price of the first primary source", async () => {
          await compositeOracle.setPrimarySources(
            simpleToken.address,
            ethers.utils.parseUnits("1.5", 18),
            mockOracles.slice(0, 2).map((mockOracle) => mockOracle.address),
            mockOracles.slice(0, 2).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
          );
          const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

          const cases = [
            {
              prices: [ethers.utils.parseEther("50"), ethers.utils.parseEther("75")],
              expectedPrice: ethers.utils.parseEther("50"),
            },
            {
              prices: [ethers.utils.parseEther("75"), ethers.utils.parseEther("50")],
              expectedPrice: ethers.utils.parseEther("75"),
            },
          ];

          for (const index in cases) {
            await mockOracles[0].get.returns([true, cases[index].prices[0]]);

            await mockOracles[1].get.returns([true, cases[index].prices[1]]);

            const [_, expected] = await compositeOracle.get(encodedToken);
            expect(expected, `case: ${index}`).to.eq(cases[index].expectedPrice);
          }
        });
      });
      context("when there are 3 primary sources", () => {
        context("when both [price0, price1] and [price1, price2] have a valid deviation", () => {
          it("should use the first price", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              ethers.utils.parseUnits("1.5", 18),
              mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);
            const cases = [
              {
                prices: [ethers.utils.parseEther("50"), ethers.utils.parseEther("75"), ethers.utils.parseEther("100")],
                expectedPrice: ethers.utils.parseEther("50"),
              },
              {
                prices: [ethers.utils.parseEther("75"), ethers.utils.parseEther("70"), ethers.utils.parseEther("100")],
                expectedPrice: ethers.utils.parseEther("75"),
              },
              {
                prices: [ethers.utils.parseEther("75"), ethers.utils.parseEther("70"), ethers.utils.parseEther("65")],
                expectedPrice: ethers.utils.parseEther("75"),
              },
            ];

            for (const index in cases) {
              await mockOracles[0].get.returns([true, cases[index].prices[0]]);

              await mockOracles[1].get.returns([true, cases[index].prices[1]]);

              await mockOracles[2].get.returns([true, cases[index].prices[2]]);

              const [_, expected] = await compositeOracle.get(encodedToken);
              expect(expected, `case: ${index}`).to.eq(cases[index].expectedPrice);
            }
          });
        });

        context("when [price0, price1] is valid and [price1, price2] is invalid", () => {
          it("should use the price from the most priority after sorted and compare", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              ethers.utils.parseUnits("1.5", 18),
              mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

            const cases = [
              {
                prices: [ethers.utils.parseEther("50"), ethers.utils.parseEther("75"), ethers.utils.parseEther("150")],
                expectedPrice: ethers.utils.parseEther("50"),
              },
              {
                prices: [ethers.utils.parseEther("75"), ethers.utils.parseEther("70"), ethers.utils.parseEther("150")],
                expectedPrice: ethers.utils.parseEther("75"),
              },
              {
                prices: [ethers.utils.parseEther("50"), ethers.utils.parseEther("75"), ethers.utils.parseEther("101")],
                expectedPrice: ethers.utils.parseEther("50"),
              },
              {
                prices: [ethers.utils.parseEther("75"), ethers.utils.parseEther("70"), ethers.utils.parseEther("101")],
                expectedPrice: ethers.utils.parseEther("75"),
              },
            ];

            for (const index in cases) {
              await mockOracles[0].get.returns([true, cases[index].prices[0]]);

              await mockOracles[1].get.returns([true, cases[index].prices[1]]);

              await mockOracles[2].get.returns([true, cases[index].prices[2]]);

              const [_, expected] = await compositeOracle.get(encodedToken);
              expect(expected, `case: ${index}`).to.eq(cases[index].expectedPrice);
            }
          });
        });

        context("when [price0, price1] is invalid and [price1, price2] is valid", () => {
          it("should use the price from the most priority after sorted and compare", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              ethers.utils.parseUnits("1.5", 18),
              mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

            const cases = [
              {
                prices: [ethers.utils.parseEther("20"), ethers.utils.parseEther("75"), ethers.utils.parseEther("100")],
                expectedPrice: ethers.utils.parseEther("75"),
              },
              {
                prices: [ethers.utils.parseEther("20"), ethers.utils.parseEther("100"), ethers.utils.parseEther("75")],
                expectedPrice: ethers.utils.parseEther("100"),
              },
              {
                prices: [ethers.utils.parseEther("49"), ethers.utils.parseEther("75"), ethers.utils.parseEther("100")],
                expectedPrice: ethers.utils.parseEther("75"),
              },
              {
                prices: [ethers.utils.parseEther("49"), ethers.utils.parseEther("100"), ethers.utils.parseEther("75")],
                expectedPrice: ethers.utils.parseEther("100"),
              },
            ];

            for (const index in cases) {
              await mockOracles[0].get.returns([true, cases[index].prices[0]]);

              await mockOracles[1].get.returns([true, cases[index].prices[1]]);

              await mockOracles[2].get.returns([true, cases[index].prices[2]]);

              const [_, expected] = await compositeOracle.get(encodedToken);
              expect(expected, `case: ${index}`).to.eq(cases[index].expectedPrice);
            }
          });
        });

        context("when both [price0, price1] and [price1, price2] is invalid", () => {
          it("should revert", async () => {
            await compositeOracle.setPrimarySources(
              simpleToken.address,
              ethers.utils.parseUnits("1.5", 18),
              mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
              mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
            );
            const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

            await mockOracles[0].get.returns([true, ethers.utils.parseEther("15000")]);

            await mockOracles[1].get.returns([true, ethers.utils.parseEther("1")]);

            await mockOracles[2].get.returns([true, ethers.utils.parseEther("1000")]);

            await expect(compositeOracle.get(encodedToken)).to.revertedWith(
              "CompositeOracle::_get::too much deviation (3 valid sources)"
            );
          });
        });
      });
    });
  });

  describe("#name()", () => {
    context("when there is no primary sources", () => {
      it("should revert", async () => {
        await expect(
          compositeOracle.name(ethers.utils.defaultAbiCoder.encode(["address"], [constants.AddressZero])),
          "should revert since no primary sources"
        ).to.be.revertedWith("CompositeOracle::name::no primary source");
      });
    });
    it("should return a concat name", async () => {
      await compositeOracle.setPrimarySources(
        simpleToken.address,
        ethers.utils.parseUnits("1.5", 18),
        mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
        mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
      );
      const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

      await mockOracles[0].name.returns("foo");

      await mockOracles[1].name.returns("bar");

      await mockOracles[2].name.returns("baz");

      const name = await compositeOracle.name(encodedToken);
      expect(name).to.eq("foo+bar+baz");
    });
  });

  describe("#symbol()", () => {
    context("when there is no primary sources", () => {
      it("should revert", async () => {
        await expect(
          compositeOracle.symbol(ethers.utils.defaultAbiCoder.encode(["address"], [constants.AddressZero])),
          "should revert since no primary sources"
        ).to.be.revertedWith("CompositeOracle::symbol::no primary source");
      });
    });
    it("should return a concat symbol", async () => {
      await compositeOracle.setPrimarySources(
        simpleToken.address,
        ethers.utils.parseUnits("1.5", 18),
        mockOracles.slice(0, 3).map((mockOracle) => mockOracle.address),
        mockOracles.slice(0, 3).map((_, index) => ethers.utils.defaultAbiCoder.encode(["uint256"], [index]))
      );
      const encodedToken = ethers.utils.defaultAbiCoder.encode(["address"], [simpleToken.address]);

      await mockOracles[0].symbol.returns("foo");

      await mockOracles[1].symbol.returns("bar");

      await mockOracles[2].symbol.returns("baz");

      const name = await compositeOracle.symbol(encodedToken);
      expect(name).to.eq("foo+bar+baz");
    });
  });
});
