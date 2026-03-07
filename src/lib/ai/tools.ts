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
                  indicator: { type: "string" },
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
                  indicator: { type: "string" },
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
];
