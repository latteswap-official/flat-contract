import { BigNumber, BigNumberish } from "ethers";

export function debtShareToValue(
  debtShare: BigNumberish,
  totalDebtShare: BigNumberish,
  totalDebtValue: BigNumberish,
  roudUp: boolean
): BigNumber {
  const debtShareBN = BigNumber.from(debtShare);
  const totalDebtShareBN = BigNumber.from(totalDebtShare);
  const totalDebtValueBN = BigNumber.from(totalDebtValue);

  if (totalDebtShareBN.isZero()) return debtShareBN;
  const debtValueBN = debtShareBN.mul(totalDebtValueBN).div(totalDebtShareBN);
  if (roudUp && debtValueBN.mul(totalDebtShareBN).div(totalDebtValueBN).lt(debtShareBN)) {
    return debtValueBN.add(1);
  }
  return debtValueBN;
}

export function debtValueToShare(
  debtValue: BigNumberish,
  totalDebtShare: BigNumberish,
  totalDebtValue: BigNumberish,
  roundUp: boolean
): BigNumber {
  const debtValueBN = BigNumber.from(debtValue);
  const totalDebtShareBN = BigNumber.from(totalDebtShare);
  const totalDebtValueBN = BigNumber.from(totalDebtValue);

  if (totalDebtShareBN.isZero()) return debtValueBN;
  const debtShareBN = debtValueBN.mul(totalDebtShareBN).div(totalDebtValueBN);
  if (roundUp && debtShareBN.mul(totalDebtValueBN).div(totalDebtShareBN).lt(debtValueBN)) {
    return debtShareBN.add(1);
  }
  return debtShareBN;
}
