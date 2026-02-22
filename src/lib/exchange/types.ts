export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface DetectedOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  amount: number;
  price: number | undefined;
  average: number | undefined;
  filled: number;
  remaining: number;
  status: string;
  timestamp: number;
  datetime: string;
  raw: unknown;
}

export interface BalanceInfo {
  free: number;
  used: number;
  total: number;
}

export interface OrderResult {
  id: string;
  symbol: string;
  side: string;
  amount: number;
  price: number | undefined;
  average: number | undefined;
  filled: number;
  status: string;
}
