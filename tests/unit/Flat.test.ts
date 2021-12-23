import { ethers, upgrades, waffle } from "hardhat";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as timeHelpers from "../helpers/time";
import { Clerk, Clerk__factory, FLAT, FLAT__factory } from "../../typechain/v8";
import { MockWBNB, MockWBNB__factory } from "../../typechain/v6";

chai.use(solidity);
const { expect } = chai;

describe("FLAT", async () => {
  const MAX_MINT_BPS = ethers.BigNumber.from(1500);
  const MINT_RANGE = ethers.BigNumber.from(24 * 60 * 60);

  // Accounts
  let deployer: SignerWithAddress;
  let alice: SignerWithAddress;

  // Contracts
  let wbnb: MockWBNB;
  let clerk: Clerk;
  let flat: FLAT;

  // Contract with Signer
  let flatAsAlice: FLAT;

  // Fixtures
  async function fixture() {
    [deployer, alice] = await ethers.getSigners();

    const MockWBNB = (await ethers.getContractFactory("MockWBNB")) as MockWBNB__factory;
    wbnb = await MockWBNB.deploy();

    const Clerk = (await ethers.getContractFactory("Clerk")) as Clerk__factory;
    clerk = (await upgrades.deployProxy(Clerk, [])) as Clerk;

    const FLAT = (await ethers.getContractFactory("FLAT")) as FLAT__factory;
    flat = (await upgrades.deployProxy(FLAT, [MINT_RANGE, MAX_MINT_BPS])) as FLAT;

    flatAsAlice = FLAT__factory.connect(flat.address, alice);
  }

  beforeEach(async () => {
    await waffle.loadFixture(fixture);
  });

  context("#constructor", async () => {
    it("should initailzied correctly", async () => {
      expect(await flat.mintRange()).to.eq(MINT_RANGE);
      expect(await flat.maxMintBps()).to.eq(MAX_MINT_BPS);
    });

    context("when bad init values", async () => {
      it("should revert", async () => {
        const FLAT = (await ethers.getContractFactory("FLAT")) as FLAT__factory;
        await expect(upgrades.deployProxy(FLAT, [ethers.constants.Zero, MAX_MINT_BPS])).to.be.revertedWith(
          "bad _initMintRange"
        );
        await expect(upgrades.deployProxy(FLAT, [MINT_RANGE, 9000])).to.be.revertedWith("bad _initMaxMintBps");
      });
    });
  });

  context("#mint", async () => {
    context("when mint to address(0)", async () => {
      it("should revert", async () => {
        await expect(flat.mint(ethers.constants.AddressZero, ethers.utils.parseEther("1"))).to.be.revertedWith(
          "bad _to"
        );
      });
    });

    context("when mint to any address", async () => {
      it("should limit the mint amount within mint range", async () => {
        // Initial mint
        await flat.mint(deployer.address, ethers.utils.parseEther("10000000"));
        expect(await flat.balanceOf(deployer.address)).to.eq(ethers.utils.parseEther("10000000"));
        expect(await flat.lastMintTime()).to.be.eq(await timeHelpers.latestTimestamp());
        expect(await flat.lastMintAmount()).to.eq(0);

        // Total mintable within this range is 10,000,000 * 0.15 = 1,500,000 FLAT
        // Mint 1,000,000 FLAT
        await flat.mint(deployer.address, ethers.utils.parseEther("1000000"));
        expect(await flat.balanceOf(deployer.address)).to.eq(ethers.utils.parseEther("11000000"));
        expect(await flat.lastMintTime()).to.be.eq(await timeHelpers.latestTimestamp());
        expect(await flat.lastMintAmount()).to.eq(ethers.utils.parseEther("1000000"));

        // Mint 500,000 FLAT
        await flat.mint(deployer.address, ethers.utils.parseEther("500000"));
        expect(await flat.balanceOf(deployer.address)).to.eq(ethers.utils.parseEther("11500000"));
        expect(await flat.lastMintTime()).to.be.eq(await timeHelpers.latestTimestamp());
        expect(await flat.lastMintAmount()).to.eq(ethers.utils.parseEther("1500000"));

        // Mint one more wei, this should revert
        await expect(flat.mint(deployer.address, ethers.utils.parseEther("225001"))).to.be.revertedWith(
          "exceed mint limit"
        );
      });
    });

    context("when random user call mint", async () => {
      it("should revert", async () => {
        await expect(flatAsAlice.mint(deployer.address, ethers.utils.parseEther("1"))).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
    });
  });

  context("#replenish", async () => {
    it("should limit the replenish amount within mint range", async () => {
      // Initial replenish
      await flat.replenish(deployer.address, ethers.utils.parseEther("10000000"), clerk.address);
      expect(await flat.balanceOf(clerk.address)).to.eq(ethers.utils.parseEther("10000000"));
      expect(await flat.lastMintTime()).to.be.eq(await timeHelpers.latestTimestamp());
      expect(await flat.lastMintAmount()).to.eq(0);

      // Total mintable within this range is 10,000,000 * 0.15 = 1,500,000 FLAT
      // Mint 1,000,000 FLAT
      await flat.replenish(deployer.address, ethers.utils.parseEther("1000000"), clerk.address);
      expect(await flat.balanceOf(clerk.address)).to.eq(ethers.utils.parseEther("11000000"));
      expect(await flat.lastMintTime()).to.be.eq(await timeHelpers.latestTimestamp());
      expect(await flat.lastMintAmount()).to.eq(ethers.utils.parseEther("1000000"));

      // Mint 500,000 FLAT
      await flat.replenish(deployer.address, ethers.utils.parseEther("500000"), clerk.address);
      expect(await flat.balanceOf(clerk.address)).to.eq(ethers.utils.parseEther("11500000"));
      expect(await flat.lastMintTime()).to.be.eq(await timeHelpers.latestTimestamp());
      expect(await flat.lastMintAmount()).to.eq(ethers.utils.parseEther("1500000"));

      // Mint one more wei, this should revert
      await expect(
        flat.replenish(deployer.address, ethers.utils.parseEther("225001"), clerk.address)
      ).to.be.revertedWith("exceed mint limit");
    });
  });

  context("#setMaxMintBps", async () => {
    context("when owner call setMaxMintBps", async () => {
      context("when max mint bps is invalid", async () => {
        it("should revert", async () => {
          await expect(flat.setMaxMintBps(5000)).to.be.revertedWith("bad _newMaxMintBps");
        });
      });

      context("when mint range is valid", async () => {
        it("should set the mint range", async () => {
          await flat.setMaxMintBps(3000);
          expect(await flat.maxMintBps()).to.eq(3000);
        });
      });
    });

    context("when Alice call setMaxMintBps", async () => {
      it("should revert", async () => {
        await expect(flatAsAlice.setMaxMintBps(3000)).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });
  });

  context("#setMintRange", async () => {
    context("when owner call setMintRange", async () => {
      context("when mint range is invalid", async () => {
        it("should revert", async () => {
          await expect(flat.setMintRange(ethers.BigNumber.from(0))).to.be.revertedWith("bad _newMintRange");
        });
      });

      context("when mint range is valid", async () => {
        it("should set the mint range", async () => {
          const newMintRange = ethers.BigNumber.from(24 * 60 * 60 * 2);
          await flat.setMintRange(newMintRange);
          expect(await flat.mintRange()).to.eq(newMintRange);
        });
      });
    });

    context("when Alice call setMintRange", async () => {
      it("should revert", async () => {
        await expect(flatAsAlice.setMintRange(3000)).to.be.revertedWith("Ownable: caller is not the owner");
      });
    });
  });
});
