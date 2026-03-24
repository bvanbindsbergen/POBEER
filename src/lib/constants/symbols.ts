/**
 * Centralized trading pair definitions.
 * All components should import from here instead of defining their own lists.
 */

// All available trading pairs (sorted by market cap / relevance)
export const ALL_SYMBOLS = [
  // Top 10 by market cap
  "BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT",
  "DOGE/USDT", "ADA/USDT", "AVAX/USDT", "TRX/USDT", "LINK/USDT",
  // 11-20
  "DOT/USDT", "POL/USDT", "TON/USDT", "SHIB/USDT", "LTC/USDT",
  "NEAR/USDT", "UNI/USDT", "ATOM/USDT", "APT/USDT", "ARB/USDT",
  // 21-30
  "OP/USDT", "INJ/USDT", "SUI/USDT", "FIL/USDT", "IMX/USDT",
  "RENDER/USDT", "FET/USDT", "SEI/USDT", "PEPE/USDT", "WIF/USDT",
  // 31-40 (DeFi, AI, Gaming, L2s)
  "AAVE/USDT", "MKR/USDT", "GRT/USDT", "STX/USDT", "RUNE/USDT",
  "ALGO/USDT", "FTM/USDT", "SAND/USDT", "MANA/USDT", "AXS/USDT",
  // 41-50
  "THETA/USDT", "EGLD/USDT", "FLOW/USDT", "XTZ/USDT", "EOS/USDT",
  "HBAR/USDT", "IOTA/USDT", "NEO/USDT", "KAVA/USDT", "ZIL/USDT",
];

// Subsets for different contexts
export const TOP_5_SYMBOLS = ALL_SYMBOLS.slice(0, 5);
export const TOP_10_SYMBOLS = ALL_SYMBOLS.slice(0, 10);
export const TOP_20_SYMBOLS = ALL_SYMBOLS.slice(0, 20);

// Symbols that reliably support funding rate data on major exchanges
export const FUNDING_RATE_SYMBOLS = ALL_SYMBOLS.slice(0, 10);
