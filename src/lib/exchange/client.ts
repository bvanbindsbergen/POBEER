import * as ccxt from "ccxt";
import type { ExchangeCredentials, BalanceInfo, OrderResult } from "./types";

export function createExchange(
  credentials?: ExchangeCredentials,
  sandbox = false
) {
  const exchange = new ccxt.bybit({
    apiKey: credentials?.apiKey,
    secret: credentials?.apiSecret,
    enableRateLimit: true,
    options: {
      defaultType: "spot",
    },
  });

  if (sandbox) {
    exchange.setSandboxMode(true);
  }

  return exchange;
}

export function createProExchange(
  credentials?: ExchangeCredentials,
  sandbox = false
) {
  const exchange = new ccxt.pro.bybit({
    apiKey: credentials?.apiKey,
    secret: credentials?.apiSecret,
    enableRateLimit: true,
    options: {
      defaultType: "spot",
    },
  });

  if (sandbox) {
    exchange.setSandboxMode(true);
  }

  return exchange;
}

export async function validateApiKeys(
  credentials: ExchangeCredentials
): Promise<boolean> {
  const exchange = createExchange(credentials);
  try {
    await exchange.fetchBalance({ type: "spot" });
    return true;
  } catch {
    return false;
  } finally {
    await exchange.close();
  }
}

export async function fetchUsdtBalance(
  exchange: InstanceType<typeof ccxt.bybit>
): Promise<BalanceInfo> {
  const balance = await exchange.fetchBalance({ type: "spot" });
  const usdt = balance.USDT || { free: 0, used: 0, total: 0 };
  return {
    free: Number(usdt.free) || 0,
    used: Number(usdt.used) || 0,
    total: Number(usdt.total) || 0,
  };
}

export interface TransferRecord {
  id: string;
  txid: string;
  amount: number;
  currency: string;
  timestamp: number;
  datetime: string;
}

export async function fetchDeposits(
  exchange: InstanceType<typeof ccxt.bybit>,
  since?: number,
  limit = 50
): Promise<TransferRecord[]> {
  const deposits = await exchange.fetchDeposits("USDT", since, limit);
  return deposits.map((d) => ({
    id: String(d.id),
    txid: String(d.txid || d.id),
    amount: Number(d.amount) || 0,
    currency: String(d.currency || "USDT"),
    timestamp: d.timestamp || Date.now(),
    datetime: String(d.datetime || new Date().toISOString()),
  }));
}

export async function fetchWithdrawals(
  exchange: InstanceType<typeof ccxt.bybit>,
  since?: number,
  limit = 50
): Promise<TransferRecord[]> {
  const withdrawals = await exchange.fetchWithdrawals("USDT", since, limit);
  return withdrawals.map((w) => ({
    id: String(w.id),
    txid: String(w.txid || w.id),
    amount: Number(w.amount) || 0,
    currency: String(w.currency || "USDT"),
    timestamp: w.timestamp || Date.now(),
    datetime: String(w.datetime || new Date().toISOString()),
  }));
}

export async function placeMarketOrder(
  exchange: InstanceType<typeof ccxt.bybit>,
  symbol: string,
  side: "buy" | "sell",
  amount: number
): Promise<OrderResult> {
  const order = await exchange.createOrder(symbol, "market", side, amount);
  return {
    id: String(order.id),
    symbol: String(order.symbol),
    side: String(order.side),
    amount: Number(order.amount),
    price: order.price != null ? Number(order.price) : undefined,
    average: order.average != null ? Number(order.average) : undefined,
    filled: Number(order.filled),
    status: String(order.status),
  };
}
