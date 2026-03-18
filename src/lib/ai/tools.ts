import type Anthropic from "@anthropic-ai/sdk";

export const aiTools: Anthropic.Tool[] = [
  {
    name: "fetch_candles",
    description:
      "Fetch OHLCV candlestick data for a cryptocurrency trading pair. Returns an array of candles with timestamp, open, high, low, close, volume.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: {
          type: "string",
          description: "Trading pair symbol, e.g. BTC/USDT, ETH/USDT",
        },
        timeframe: {
          type: "string",
          enum: ["1m", "5m", "15m", "1h", "4h", "1d"],
          description: "Candle timeframe",
        },
        days_back: {
          type: "number",
          description: "Number of days of historical data to fetch (max 365)",
        },
        limit: {
          type: "number",
          description: "Max number of candles to return (optional, default all)",
        },
      },
      required: ["symbol", "timeframe", "days_back"],
    },
  },
  {
    name: "calculate_indicators",
    description:
      "Calculate technical indicators for a trading pair. Returns computed indicator values aligned with candle timestamps. Available indicators: rsi, macd, bollinger, ema, sma, atr, stochastic, volume_sma.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: {
          type: "string",
          description: "Trading pair symbol, e.g. BTC/USDT",
        },
        timeframe: {
          type: "string",
          enum: ["1m", "5m", "15m", "1h", "4h", "1d"],
          description: "Candle timeframe",
        },
        indicators: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                enum: [
                  "rsi",
                  "macd",
                  "bollinger",
                  "ema",
                  "sma",
                  "atr",
                  "stochastic",
                  "volume_sma",
                  "funding_rate",
                  "funding_signal",
                  "reddit_sentiment",
                  "reddit_buzz",
                  "google_trends",
                  "whale_flow_signal",
                ],
              },
              params: {
                type: "object",
                description: "Optional params like { period: 14 }",
              },
            },
            required: ["name"],
          },
          description: "List of indicators to calculate",
        },
      },
      required: ["symbol", "timeframe", "indicators"],
    },
  },
  {
    name: "get_crypto_news",
    description:
      "Get recent cryptocurrency news and sentiment from CryptoPanic. Returns headlines, sources, sentiment scores.",
    input_schema: {
      type: "object" as const,
      properties: {
        currencies: {
          type: "array",
          items: { type: "string" },
          description: "Currency codes to filter by, e.g. ['BTC', 'ETH']",
        },
        kind: {
          type: "string",
          enum: ["news", "media", "all"],
          description: "Type of content to fetch",
        },
      },
      required: [],
    },
  },
  {
    name: "run_backtest",
    description:
      "Run a backtest simulation for a trading strategy. Define entry/exit conditions using technical indicators, stop loss, take profit, and position sizing. Returns performance metrics and trade history.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: {
          type: "string",
          description: "Trading pair, e.g. BTC/USDT",
        },
        timeframe: {
          type: "string",
          enum: ["1m", "5m", "15m", "1h", "4h", "1d"],
        },
        start_date: {
          type: "string",
          description: "Start date YYYY-MM-DD",
        },
        end_date: {
          type: "string",
          description: "End date YYYY-MM-DD",
        },
        strategy: {
          type: "object",
          properties: {
            name: { type: "string" },
            entryConditions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  indicator: {
                    type: "string",
                    description: "Technical: rsi, macd, bollinger, ema, sma, atr, stochastic, volume_sma. Alternative data: funding_rate (per-symbol rate), funding_signal (-2 to 2), reddit_sentiment (-100 to 100), reddit_buzz (0-100), google_trends (0-100), whale_flow_signal (-100 to 100, negative=accumulation)",
                  },
                  params: { type: "object" },
                  field: { type: "string" },
                  operator: {
                    type: "string",
                    enum: [">", "<", ">=", "<=", "crosses_above", "crosses_below"],
                  },
                  value: {},
                },
                required: ["indicator", "operator", "value"],
              },
            },
            exitConditions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  indicator: {
                    type: "string",
                    description: "Same indicators as entry conditions",
                  },
                  params: { type: "object" },
                  field: { type: "string" },
                  operator: { type: "string" },
                  value: {},
                },
                required: ["indicator", "operator", "value"],
              },
            },
            stopLossPercent: { type: "number" },
            takeProfitPercent: { type: "number" },
            positionSizePercent: { type: "number" },
          },
          required: ["entryConditions", "exitConditions", "positionSizePercent"],
        },
      },
      required: ["symbol", "timeframe", "start_date", "end_date", "strategy"],
    },
  },
  {
    name: "get_market_overview",
    description:
      "Get a market overview including trending coins, top gainers and losers from CoinGecko.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_whale_transactions",
    description:
      "Get recent large whale transactions and on-chain exchange flow data. Shows large transfers, exchange inflows/outflows, and whether smart money is accumulating or distributing. Supports optional Whale Alert API key or falls back to Blockchair free API.",
    input_schema: {
      type: "object" as const,
      properties: {
        currency: {
          type: "string",
          description:
            "Currency to filter by, e.g. 'btc', 'eth'. Optional, defaults to all.",
        },
        min_usd: {
          type: "number",
          description:
            "Minimum transaction value in USD (default 500000)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_google_trends",
    description:
      "Get Google Trends search interest data for crypto-related keywords. Measures retail FOMO levels — extreme search interest historically correlates with market tops. Returns interest scores (0-100), trend direction, and FOMO signal levels.",
    input_schema: {
      type: "object" as const,
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description:
            "Keywords to check trends for, e.g. ['bitcoin', 'buy crypto', 'altcoins']. Defaults to ['bitcoin', 'crypto', 'buy bitcoin'].",
        },
      },
      required: [],
    },
  },
  {
    name: "get_funding_rates",
    description:
      "Get perpetual futures funding rates and open interest data. Shows leverage bias, crowded positions, and liquidation risk. Positive funding = longs paying shorts (crowded long), negative = shorts paying longs (crowded short). Uses CCXT (Bybit) or Coinglass as fallback.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description:
            "Trading pairs to check, e.g. ['BTC/USDT', 'ETH/USDT']. Defaults to BTC, ETH, SOL.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_reddit_sentiment",
    description:
      "Get Reddit sentiment analysis from crypto subreddits. Analyzes post titles and content for bullish/bearish keywords, calculates sentiment percentages, buzz scores, and highlights top posts. No API key needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        subreddits: {
          type: "array",
          items: { type: "string" },
          description:
            "Subreddits to analyze, e.g. ['cryptocurrency', 'bitcoin']. Defaults to cryptocurrency, bitcoin, ethtrader.",
        },
        currency: {
          type: "string",
          description:
            "Filter posts mentioning a specific currency, e.g. 'BTC', 'ETH'. Optional.",
        },
      },
      required: [],
    },
  },
];
