import { MockProvider } from "ethereum-waffle";
import { BigNumber, Signer, Wallet } from "ethers";
import { ethers, upgrades } from "hardhat";
import { CompositeOracle, CompositeOracle__factory, MockOracle, SimpleToken } from "../../../typechain/v8";
import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";

export interface ICompositeOracleDTO {
  compositeOracle: CompositeOracle;
  simpleToken: SimpleToken;
  mockOracles: Array<FakeContract<MockOracle>>;
}

export async function compositeOracleUnitTestFixture(
  maybeWallets?: Wallet[],
  maybeProvider?: MockProvider
): Promise<ICompositeOracleDTO> {
  const [deployer] = await ethers.getSigners();

  const CompositeOracle = new CompositeOracle__factory(deployer);
  const compositeOracle = await upgrades.deployProxy(CompositeOracle, []);

  const simpleToken = await (await ethers.getContractFactory("SimpleToken")).deploy();

  const mockOracles = [];
  for (let i = 0; i < 4; i++) {
    const mockOracle: FakeContract<MockOracle> = await smock.fake<MockOracle>("MockOracle");

    mockOracles.push(mockOracle);
  }

  return {
    compositeOracle,
    simpleToken,
    mockOracles,
  } as ICompositeOracleDTO;
}
