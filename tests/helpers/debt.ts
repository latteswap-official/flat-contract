import { BigNumber, BigNumberish } from "ethers";

export function debtShareToValue(
  debtShare: BigNumberish,
  totalDebtShare: BigNumberish,
  totalDebtValue: BigNumberish
): BigNumber {
  const debtShareBN = BigNumber.from(debtShare);
  const totalDebtShareBN = BigNumber.from(totalDebtShare);
  const totalDebtValueBN = BigNumber.from(totalDebtValue);

  if (totalDebtShareBN.isZero()) return debtShareBN;
  const debtValueBN = debtShareBN.mul(totalDebtValueBN).div(totalDebtShareBN);

  return debtValueBN;
}

export function debtValueToShare(
  debtValue: BigNumberish,
  totalDebtShare: BigNumberish,
  totalDebtValue: BigNumberish
): BigNumber {
  const debtValueBN = BigNumber.from(debtValue);
  const totalDebtShareBN = BigNumber.from(totalDebtShare);
  const totalDebtValueBN = BigNumber.from(totalDebtValue);

  if (totalDebtShareBN.isZero()) return debtValueBN;
  const debtShareBN = debtValueBN.mul(totalDebtShareBN).div(totalDebtValueBN);
  if (debtShareBN.mul(totalDebtValueBN).div(totalDebtShareBN).lt(debtValueBN)) {
    return debtShareBN.add(1);
  }
  return debtShareBN;
}
