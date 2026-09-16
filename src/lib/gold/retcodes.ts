export type RetcodeBucket = "RetriableWithNewQuote" | "TerminalRejection" | "MarketCondition" | "Unclassified";

const RETRIABLE_WITH_NEW_QUOTE = new Set([10004, 10021]);
const TERMINAL_REJECTION = new Set([10014, 10015, 10016, 10019]);
const MARKET_CONDITION = new Set([10018, 10027]);

export function classifyRetcode(retcode: number): RetcodeBucket {
  if (RETRIABLE_WITH_NEW_QUOTE.has(retcode)) return "RetriableWithNewQuote";
  if (TERMINAL_REJECTION.has(retcode)) return "TerminalRejection";
  if (MARKET_CONDITION.has(retcode)) return "MarketCondition";
  return "Unclassified";
}
