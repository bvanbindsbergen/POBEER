import { fetchCandles } from "./data/candles";
import { fetchCryptoNews } from "./data/news";
import { fetchMarketOverview } from "./data/market";
import { fetchWhaleTransactions } from "./data/whale-alert";
import { fetchGoogleTrends } from "./data/google-trends";
import { fetchDerivativesOverview } from "./data/funding-rates";
import { fetchRedditSentiment } from "./data/reddit-sentiment";
import { calculateIndicator, type IndicatorName } from "./indicators";
import { runBacktest } from "./backtest/engine";
import type { StrategyConfig } from "./backtest/types";
import { db } from "@/lib/db";
import { backtests } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string
): Promise<string> {
  switch (toolName) {
    case "fetch_candles": {
      const { symbol, timeframe, days_back, limit } = toolInput as {
        symbol: string;
        timeframe: string;
        days_back: number;
        limit?: number;
      };
      const candles = await fetchCandles(symbol, timeframe, Math.min(days_back, 365), limit);
      // Return summary to save tokens
      if (candles.length > 50) {
        const last20 = candles.slice(-20);
        return JSON.stringify({
          totalCandles: candles.length,
          firstTimestamp: new Date(candles[0].timestamp).toISOString(),
          lastTimestamp: new Date(candles[candles.length - 1].timestamp).toISOString(),
          currentPrice: candles[candles.length - 1].close,
          high24h: Math.max(...candles.slice(-24).map((c) => c.high)),
          low24h: Math.min(...candles.slice(-24).map((c) => c.low)),
          recentCandles: last20,
        });
      }
      return JSON.stringify({ candles });
    }

    case "calculate_indicators": {
      const { symbol, timeframe, indicators } = toolInput as {
        symbol: string;
        timeframe: string;
        indicators: { name: string; params?: Record<string, number> }[];
      };
      const candles = await fetchCandles(symbol, timeframe, 90);
      const results = indicators.map((ind) => {
        const result = calculateIndicator(
          ind.name as IndicatorName,
          candles,
          ind.params
        );
        // Return only last 20 values to save tokens
        const len = result.values.length;
        const start = Math.max(0, len - 20);
        return {
          name: result.name,
          latestValues: result.values.slice(start),
          latestTimestamps: result.timestamps.slice(start).map((t) => new Date(t).toISOString()),
        };
      });
      return JSON.stringify({ indicators: results });
    }

    case "get_crypto_news": {
      const { currencies, kind } = toolInput as {
        currencies?: string[];
        kind?: string;
      };
      const news = await fetchCryptoNews(currencies, kind);
      return JSON.stringify({ news: news.slice(0, 15) });
    }

    case "run_backtest": {
      const { symbol, timeframe, start_date, end_date, strategy } = toolInput as {
        symbol: string;
        timeframe: string;
        start_date: string;
        end_date: string;
        strategy: StrategyConfig;
      };

      const start = new Date(start_date);
      const end = new Date(end_date);
      const daysBack = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const candles = await fetchCandles(symbol, timeframe, daysBack);
      const filtered = candles.filter(
        (c) => c.timestamp >= start.getTime() && c.timestamp <= end.getTime()
      );

      const result = runBacktest(filtered, strategy);

      // Store in database
      const [record] = await db
        .insert(backtests)
        .values({
          userId,
          symbol,
          timeframe,
          startDate: start_date,
          endDate: end_date,
          strategyConfig: JSON.stringify(strategy),
          status: "completed",
          totalPnl: String(result.totalPnl),
          winRate: String(result.winRate),
          maxDrawdown: String(result.maxDrawdown),
          sharpeRatio: String(result.sharpeRatio),
          profitFactor: String(result.profitFactor),
          totalTrades: result.totalTrades,
          trades: JSON.stringify(result.trades),
          equityCurve: JSON.stringify(result.equityCurve),
        })
        .returning();

      return JSON.stringify({
        backtestId: record.id,
        symbol,
        timeframe,
        period: `${start_date} to ${end_date}`,
        totalPnl: result.totalPnl.toFixed(2),
        winRate: (result.winRate * 100).toFixed(1) + "%",
        maxDrawdown: (result.maxDrawdown * 100).toFixed(1) + "%",
        sharpeRatio: result.sharpeRatio.toFixed(2),
        profitFactor: result.profitFactor === Infinity ? "Inf" : result.profitFactor.toFixed(2),
        totalTrades: result.totalTrades,
        avgWin: result.avgWin.toFixed(2),
        avgLoss: result.avgLoss.toFixed(2),
      });
    }

    case "get_market_overview": {
      const overview = await fetchMarketOverview();
      return JSON.stringify(overview);
    }

    case "get_whale_transactions": {
      const { currency, min_usd } = toolInput as {
        currency?: string;
        min_usd?: number;
      };
      const whaleData = await fetchWhaleTransactions(currency, min_usd);
      return JSON.stringify(whaleData);
    }

    case "get_google_trends": {
      const { keywords } = toolInput as { keywords?: string[] };
      const trends = await fetchGoogleTrends(keywords);
      return JSON.stringify(trends);
    }

    case "get_funding_rates": {
      const { symbols } = toolInput as { symbols?: string[] };
      const derivatives = await fetchDerivativesOverview(symbols);
      return JSON.stringify(derivatives);
    }

    case "get_reddit_sentiment": {
      const { subreddits, currency } = toolInput as {
        subreddits?: string[];
        currency?: string;
      };
      const reddit = await fetchRedditSentiment(subreddits, currency);
      return JSON.stringify(reddit);
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}
