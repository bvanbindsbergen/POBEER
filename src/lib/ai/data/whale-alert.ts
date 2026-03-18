import { db } from "@/lib/db";
import { newsCache } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";

export interface WhaleTransaction {
  blockchain: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: string;
  to: string;
  timestamp: number;
  hash: string;
}

export interface OnChainSummary {
  transactions: WhaleTransaction[];
  exchangeInflows: number;
  exchangeOutflows: number;
  netFlow: number;
  flowSignal: "accumulation" | "distribution" | "neutral";
  largestTx: WhaleTransaction | null;
}

const EXCHANGE_WALLETS = [
  "binance",
  "coinbase",
  "kraken",
  "bitfinex",
  "huobi",
  "okex",
  "kucoin",
  "bybit",
  "gate.io",
  "gemini",
];

function isExchangeWallet(label: string): boolean {
  const lower = label.toLowerCase();
  return EXCHANGE_WALLETS.some((ex) => lower.includes(ex));
}

async function fetchWithCache<T>(
  source: string,
  cacheKey: string,
  ttlMinutes: number,
  fetcher: () => Promise<T>
): Promise<T | null> {
  const cached = await db
    .select()
    .from(newsCache)
    .where(
      and(
        eq(newsCache.source, source),
        eq(newsCache.cacheKey, cacheKey),
        gt(newsCache.expiresAt, new Date())
      )
    )
    .limit(1);

  if (cached.length > 0) {
    return JSON.parse(cached[0].data);
  }

  try {
    const data = await fetcher();
    await db.insert(newsCache).values({
      source,
      cacheKey,
      data: JSON.stringify(data),
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
    });
    return data;
  } catch (error) {
    console.error(`${source} fetch error:`, error);
    return null;
  }
}

export async function fetchWhaleTransactions(
  currency?: string,
  minUsd: number = 500000
): Promise<OnChainSummary> {
  const key = `whale:${currency || "all"}:${minUsd}`;

  const data = await fetchWithCache<OnChainSummary>(
    "whale-alert",
    key,
    10,
    async () => {
      const apiKey = process.env.WHALE_ALERT_API_KEY;

      // Use Whale Alert API if key is available, otherwise use Blockchair free API
      if (apiKey) {
        return fetchFromWhaleAlert(apiKey, currency, minUsd);
      }
      return fetchFromBlockchair(currency, minUsd);
    }
  );

  return (
    data || {
      transactions: [],
      exchangeInflows: 0,
      exchangeOutflows: 0,
      netFlow: 0,
      flowSignal: "neutral",
      largestTx: null,
    }
  );
}

async function fetchFromWhaleAlert(
  apiKey: string,
  currency?: string,
  minUsd: number = 500000
): Promise<OnChainSummary> {
  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 3600;

  const params = new URLSearchParams({
    api_key: apiKey,
    min_value: String(minUsd),
    start: String(oneHourAgo),
    end: String(now),
  });
  if (currency) {
    params.set("currency", currency.toLowerCase());
  }

  const res = await fetch(
    `https://api.whale-alert.io/v1/transactions?${params.toString()}`
  );
  if (!res.ok) return emptyResult();

  const json = await res.json();
  const txs: WhaleTransaction[] = (json.transactions || []).map(
    (tx: {
      blockchain: string;
      symbol: string;
      amount: number;
      amount_usd: number;
      from: { owner: string; owner_type: string };
      to: { owner: string; owner_type: string };
      timestamp: number;
      hash: string;
    }) => ({
      blockchain: tx.blockchain,
      symbol: tx.symbol.toUpperCase(),
      amount: tx.amount,
      amountUsd: tx.amount_usd,
      from: tx.from.owner || tx.from.owner_type || "unknown",
      to: tx.to.owner || tx.to.owner_type || "unknown",
      timestamp: tx.timestamp * 1000,
      hash: tx.hash,
    })
  );

  return summarizeTransactions(txs);
}

async function fetchFromBlockchair(
  currency?: string,
  minUsd: number = 500000
): Promise<OnChainSummary> {
  // Blockchair free API - fetch large BTC transactions as fallback
  const chain = currency?.toLowerCase() === "eth" ? "ethereum" : "bitcoin";
  const minBtc = chain === "bitcoin" ? minUsd / 60000 : minUsd / 3000; // rough estimates

  const res = await fetch(
    `https://api.blockchair.com/${chain}/transactions?limit=20&s=output_total(desc)&q=output_total(${Math.floor(minBtc * 1e8)}..)`,
    { headers: { accept: "application/json" } }
  );
  if (!res.ok) return emptyResult();

  const json = await res.json();
  const txs: WhaleTransaction[] = (json.data || []).slice(0, 20).map(
    (tx: {
      hash: string;
      output_total: number;
      output_total_usd: number;
      time: string;
    }) => ({
      blockchain: chain,
      symbol: chain === "bitcoin" ? "BTC" : "ETH",
      amount: tx.output_total / 1e8,
      amountUsd: tx.output_total_usd || 0,
      from: "unknown",
      to: "unknown",
      timestamp: new Date(tx.time).getTime(),
      hash: tx.hash,
    })
  );

  return summarizeTransactions(txs);
}

function summarizeTransactions(txs: WhaleTransaction[]): OnChainSummary {
  let exchangeInflows = 0;
  let exchangeOutflows = 0;

  for (const tx of txs) {
    const toExchange = isExchangeWallet(tx.to);
    const fromExchange = isExchangeWallet(tx.from);

    if (toExchange && !fromExchange) {
      exchangeInflows += tx.amountUsd;
    } else if (fromExchange && !toExchange) {
      exchangeOutflows += tx.amountUsd;
    }
  }

  const netFlow = exchangeInflows - exchangeOutflows;
  let flowSignal: "accumulation" | "distribution" | "neutral" = "neutral";
  if (netFlow < -1000000) flowSignal = "accumulation"; // outflows > inflows = accumulation
  if (netFlow > 1000000) flowSignal = "distribution"; // inflows > outflows = distribution

  const largestTx =
    txs.length > 0
      ? txs.reduce((max, tx) => (tx.amountUsd > max.amountUsd ? tx : max))
      : null;

  return {
    transactions: txs.slice(0, 10),
    exchangeInflows,
    exchangeOutflows,
    netFlow,
    flowSignal,
    largestTx,
  };
}

function emptyResult(): OnChainSummary {
  return {
    transactions: [],
    exchangeInflows: 0,
    exchangeOutflows: 0,
    netFlow: 0,
    flowSignal: "neutral",
    largestTx: null,
  };
}
