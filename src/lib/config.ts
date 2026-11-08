export const CONFIG = {
  minTopUpCents: 500,
  maxBalanceCents: 15000,
  fareCents: 200,
  smartTopUpTriggerCents: 400,
  smartTopUpAmountCents: 1000,
  amountChipsCents: [500, 1000, 2000, 3000],
  realtimePollMs: 20000,
  apiTimeoutMs: 8000,
  /** Routes a new user starts with on the Live tab. RECORDED demo data covers these only. */
  defaultRoutes: ["E1", "39A", "16"],
} as const;
