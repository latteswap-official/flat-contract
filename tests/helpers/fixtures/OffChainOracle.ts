import { MockProvider } from "ethereum-waffle";
import { BigNumber, Signer, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import {
  OffChainOracle,
  OffChainOracle__factory,
  MockOracle,
  SimpleToken,
  SimpleToken__factory,
} from "../../../typechain/v8";
import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";

export interface IOffchainOracleDTO {
  offChainOracle: OffChainOracle;
  simpleTokens: Array<SimpleToken>;
}

export async function offChainOracleUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<IOffchainOracleDTO> {
  const [deployer] = await ethers.getSigners();

  const OffChainOracle = new OffChainOracle__factory(deployer);
  const offChainOracle = await upgrades.deployProxy(OffChainOracle, []);

  const simpleTokens = [];
  for (let i = 0; i < 4; i++) {
    const SimpleToken = (await ethers.getContractFactory("SimpleToken", deployer)) as SimpleToken__factory;
    const simpleToken = (await SimpleToken.deploy()) as SimpleToken;

    simpleTokens.push(simpleToken);
  }

  return {
    offChainOracle,
    simpleTokens,
  } as IOffchainOracleDTO;
}
