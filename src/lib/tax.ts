export type WithholdingType = "wt_3_3" | "wt_8_8" | "none";

export interface WithholdingBreakdown {
  incomeTax: number;
  localTax: number;
  withholding: number;
  net: number;
}

const INCOME_TAX_RATES = {
  wt_3_3: BigInt(3),
  wt_8_8: BigInt(8),
  none: BigInt(0)
} satisfies Record<WithholdingType, bigint>;

const PERCENT_DENOMINATOR = BigInt(100);
const TEN_WON = BigInt(10);

export function calcWithholding(amount: number, type: WithholdingType): WithholdingBreakdown {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    // invoices.amount has CHECK (amount > 0); reject invalid snapshot inputs early.
    throw new Error("amount must be a positive integer");
  }

  const amountWon = BigInt(amount);
  const incomeTax = (amountWon * INCOME_TAX_RATES[type]) / PERCENT_DENOMINATOR;
  const localTax = (incomeTax / PERCENT_DENOMINATOR) * TEN_WON;
  const withholding = incomeTax + localTax;
  const net = amountWon - withholding;

  return {
    incomeTax: incomeTax,
    localTax: Number(localTax),
    withholding: Number(withholding),
    net: Number(net)
  };
}
