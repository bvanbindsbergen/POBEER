# Crucix Crypto Geo Activity Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 crypto geographic data sources to the Crucix OSINT dashboard with globe visualization layers, a fast-cycle timer for real-time whale/liquidation data, and a Crypto Focus Mode.

**Architecture:** Bolt-on source modules following Crucix's existing pattern (each source exports `briefing()`). A second `setInterval` in `server.mjs` runs whale-alert + coinglass every 2.5 min. Dashboard gets 5 new Globe.gl layers and a topbar focus toggle. POBEER's `crucix.ts` is extended to consume the new crypto data for AI strategy context.

**Tech Stack:** Node.js/Express (Crucix), Globe.gl/D3.js/Three.js (visualization), Whale Alert API, CoinGlass API, SerpAPI, Bitnodes API, Bisq API

**Repos:**
- Crucix: `C:/Crucix` (https://github.com/bvanbindsbergen/Crucix)
- POBEER: `C:/POBEER`

**Spec:** `C:/POBEER/docs/superpowers/specs/2026-03-20-crucix-crypto-geo-map-design.md`

---

## File Structure

### New Files (Crucix)

| File | Responsibility |
|---|---|
| `apis/sources/whale-alert.mjs` | Fetch large crypto transactions from Whale Alert API |
| `apis/sources/coinglass.mjs` | Fetch liquidation data and open interest from CoinGlass |
| `apis/sources/google-trends-geo.mjs` | Fetch regional crypto search interest via SerpAPI |
| `apis/sources/p2p-volume.mjs` | Fetch P2P trading volumes by country from Bisq |
| `apis/sources/bitnodes.mjs` | Fetch Bitcoin node geographic distribution |

### Modified Files (Crucix)

| File | Changes |
|---|---|
| `apis/briefing.mjs` | Add Tier 6 imports, 5 new sources to `allPromises` |
| `crucix.config.mjs` | Add `cryptoFastIntervalMinutes` and `trendsIntervalMinutes` settings |
| `server.mjs` | Add `runCryptoFastCycle()`, fast interval, `crypto_update` SSE event |
| `dashboard/inject.mjs` | Add `synthesizeCrypto()`, exchange geo table, `crypto` key in output |
| `dashboard/public/jarvis.html` | Add 5 globe layers, crypto focus mode, topbar toggle, crypto panels, CSS |

### Modified Files (POBEER)

| File | Changes |
|---|---|
| `src/lib/ai/data/crucix.ts` | Extend `CrucixIntelligence` with `crypto` field |
| `src/lib/ai/funnel/ai-generator.ts` | Add crypto geo context to AI strategy prompt |

---

## Task 1: Whale Alert Source Module

**Files:**
- Create: `C:/Crucix/apis/sources/whale-alert.mjs`

- [ ] **Step 1: Create whale-alert.mjs**

```js
// Whale Alert API — Large crypto transaction tracking
// Requires WHALE_ALERT_API_KEY in .env
// Docs: https://docs.whale-alert.io/

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const API_BASE = 'https://api.whale-alert.io/v1';

export async function briefing() {
  const key = process.env.WHALE_ALERT_API_KEY;
  if (!key) return { error: 'WHALE_ALERT_API_KEY not set', transactions: [] };

  // Fetch transactions from last 3600 seconds (1 hour), min $500k
  const since = Math.floor(Date.now() / 1000) - 3600;
  const url = `${API_BASE}/transactions?api_key=${key}&min_value=500000&start=${since}`;

  const data = await safeFetch(url, { timeout: 10000 });
  if (data.error) return { error: data.error, transactions: [] };

  const txs = (data.transactions || []).map(tx => ({
    hash: tx.hash || '',
    from: {
      owner: tx.from?.owner || 'unknown',
      ownerType: tx.from?.owner_type || 'unknown',
    },
    to: {
      owner: tx.to?.owner || 'unknown',
      ownerType: tx.to?.owner_type || 'unknown',
    },
    amount: tx.amount || 0,
    symbol: (tx.symbol || '').toUpperCase(),
    usdValue: tx.amount_usd || 0,
    timestamp: tx.timestamp || 0,
  }));

  return {
    transactions: txs.sort((a, b) => b.usdValue - a.usdValue).slice(0, 50),
    totalCount: data.count || txs.length,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Verify module loads without errors**

Run from Crucix root:
```bash
cd C:/Crucix && node -e "import('./apis/sources/whale-alert.mjs').then(m => console.log('OK:', typeof m.briefing))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
cd C:/Crucix && git add apis/sources/whale-alert.mjs && git commit -m "feat: add whale-alert source module for crypto transaction tracking"
```

---

## Task 2: CoinGlass Source Module

**Files:**
- Create: `C:/Crucix/apis/sources/coinglass.mjs`

- [ ] **Step 1: Create coinglass.mjs**

```js
// CoinGlass — Liquidation data and open interest
// Public API, no key required (rate-limited)
// Provides exchange-level liquidation volumes

import { safeFetch } from '../utils/fetch.mjs';

const API_BASE = 'https://open-api.coinglass.com/public/v2';

export async function briefing() {
  const [liqData, oiData] = await Promise.allSettled([
    safeFetch(`${API_BASE}/liquidation/info?time_type=1&symbol=`, { timeout: 10000 }),
    safeFetch(`${API_BASE}/open_interest/ohlc/agg_info?symbol=BTC`, { timeout: 10000 }),
  ]);

  const liqResult = liqData.status === 'fulfilled' ? liqData.value : {};
  const oiResult = oiData.status === 'fulfilled' ? oiData.value : {};

  // Parse liquidation data by exchange
  const liqList = Array.isArray(liqResult.data) ? liqResult.data : [];
  const liquidations = liqList.map(item => ({
    exchange: item.exchangeName || 'Unknown',
    symbol: item.symbol || 'ALL',
    longVolume24h: item.longVolUsd || 0,
    shortVolume24h: item.shortVolUsd || 0,
    total24h: (item.longVolUsd || 0) + (item.shortVolUsd || 0),
  })).filter(l => l.total24h > 0);

  const totalLong = liquidations.reduce((s, l) => s + l.longVolume24h, 0);
  const totalShort = liquidations.reduce((s, l) => s + l.shortVolume24h, 0);

  // Parse open interest
  const oiList = Array.isArray(oiResult.data) ? oiResult.data : [];
  const btcOI = oiList.reduce((s, item) => s + (item.openInterest || 0), 0);

  return {
    liquidations,
    totalLong24h: totalLong,
    totalShort24h: totalShort,
    openInterest: { btc: btcOI, total: btcOI },
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Verify module loads without errors**

```bash
cd C:/Crucix && node -e "import('./apis/sources/coinglass.mjs').then(m => console.log('OK:', typeof m.briefing))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
cd C:/Crucix && git add apis/sources/coinglass.mjs && git commit -m "feat: add coinglass source module for liquidation and open interest data"
```

---

## Task 3: Google Trends Geo Source Module

**Files:**
- Create: `C:/Crucix/apis/sources/google-trends-geo.mjs`

- [ ] **Step 1: Create google-trends-geo.mjs**

```js
// Google Trends by Region — Crypto search interest by country
// Uses SerpAPI (SERPAPI_KEY required for geo breakdown)
// Default 60-min cycle to stay within free tier (100/mo)

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';

const API_BASE = 'https://serpapi.com/search.json';

// Country centroids for geo-plotting
const countryCentroids = {
  US: [39, -98], NG: [10, 8], TR: [39, 35], AR: [-38, -63], BR: [-14, -51],
  IN: [20, 78], KR: [37, 127], JP: [36, 138], DE: [51, 10], GB: [54, -2],
  PH: [13, 122], VN: [16, 108], ID: [-2, 118], ZA: [-30, 25], KE: [-1, 38],
  CO: [4, -74], MX: [23, -102], UA: [49, 32], PK: [30, 70], EG: [27, 30],
  TH: [15, 100], PL: [52, 20], AU: [-25, 134], CA: [56, -96], FR: [46, 2],
  ES: [40, -4], IT: [42, 12], NL: [52, 5], RU: [56, 38], SA: [24, 45],
  AE: [24, 54], SG: [1.35, 103.8], HK: [22.3, 114.2], CH: [47, 8],
  SE: [62, 15], NO: [62, 10], CL: [-35, -71], PE: [-10, -76], VE: [7, -66],
  GH: [8, -1], TZ: [-6, 35], ET: [9, 38], MA: [32, -6], TN: [34, 9],
};

export async function briefing() {
  const key = process.env.SERPAPI_KEY;
  if (!key) return { error: 'SERPAPI_KEY not set', regions: [] };

  const url = `${API_BASE}?engine=google_trends&q=bitcoin,crypto&data_type=GEO_MAP&api_key=${key}`;
  const data = await safeFetch(url, { timeout: 15000 });
  if (data.error) return { error: data.error, regions: [] };

  const compared = data.compared_breakdown_by_region || [];
  const regions = [];

  for (const entry of compared) {
    const code = entry.geo || '';
    const coords = countryCentroids[code];
    if (!coords) continue;

    regions.push({
      country: entry.location || code,
      code,
      interest: entry.value || entry.extracted_value || 0,
      change: entry.change || 0,
      lat: coords[0],
      lon: coords[1],
    });
  }

  return {
    regions: regions.sort((a, b) => b.interest - a.interest).slice(0, 30),
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Verify module loads without errors**

```bash
cd C:/Crucix && node -e "import('./apis/sources/google-trends-geo.mjs').then(m => console.log('OK:', typeof m.briefing))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
cd C:/Crucix && git add apis/sources/google-trends-geo.mjs && git commit -m "feat: add google-trends-geo source for regional crypto search interest"
```

---

## Task 4: P2P Volume Source Module

**Files:**
- Create: `C:/Crucix/apis/sources/p2p-volume.mjs`

- [ ] **Step 1: Create p2p-volume.mjs**

```js
// P2P Volume — Peer-to-peer crypto trading volumes by country
// Sources: Bisq public API (offers endpoint)
// Fallback: Chainalysis-inspired adoption index (static baseline)

import { safeFetch } from '../utils/fetch.mjs';

const BISQ_API = 'https://bisq.markets/api/offers';

// Static adoption baseline (Chainalysis Global Crypto Adoption Index 2025 top countries)
// Used as fallback when live P2P APIs don't provide country breakdown
const adoptionBaseline = [
  { country: 'Nigeria', code: 'NG', score: 100, lat: 10, lon: 8 },
  { country: 'India', code: 'IN', score: 95, lat: 20, lon: 78 },
  { country: 'Vietnam', code: 'VN', score: 90, lat: 16, lon: 108 },
  { country: 'Philippines', code: 'PH', score: 85, lat: 13, lon: 122 },
  { country: 'Ukraine', code: 'UA', score: 82, lat: 49, lon: 32 },
  { country: 'Brazil', code: 'BR', score: 78, lat: -14, lon: -51 },
  { country: 'Turkey', code: 'TR', score: 75, lat: 39, lon: 35 },
  { country: 'Argentina', code: 'AR', score: 72, lat: -38, lon: -63 },
  { country: 'Indonesia', code: 'ID', score: 70, lat: -2, lon: 118 },
  { country: 'Pakistan', code: 'PK', score: 68, lat: 30, lon: 70 },
  { country: 'Thailand', code: 'TH', score: 65, lat: 15, lon: 100 },
  { country: 'Kenya', code: 'KE', score: 62, lat: -1, lon: 38 },
  { country: 'Russia', code: 'RU', score: 60, lat: 56, lon: 38 },
  { country: 'Colombia', code: 'CO', score: 58, lat: 4, lon: -74 },
  { country: 'Mexico', code: 'MX', score: 55, lat: 23, lon: -102 },
];

// Map fiat currency to likely country
const currencyCountry = {
  USD: { country: 'United States', code: 'US', lat: 39, lon: -98 },
  EUR: { country: 'EU', code: 'EU', lat: 50, lon: 4 },
  GBP: { country: 'United Kingdom', code: 'GB', lat: 54, lon: -2 },
  BRL: { country: 'Brazil', code: 'BR', lat: -14, lon: -51 },
  ARS: { country: 'Argentina', code: 'AR', lat: -38, lon: -63 },
  NGN: { country: 'Nigeria', code: 'NG', lat: 10, lon: 8 },
  TRY: { country: 'Turkey', code: 'TR', lat: 39, lon: 35 },
  INR: { country: 'India', code: 'IN', lat: 20, lon: 78 },
  KRW: { country: 'South Korea', code: 'KR', lat: 37, lon: 127 },
  JPY: { country: 'Japan', code: 'JP', lat: 36, lon: 138 },
  AUD: { country: 'Australia', code: 'AU', lat: -25, lon: 134 },
  CAD: { country: 'Canada', code: 'CA', lat: 56, lon: -96 },
  CHF: { country: 'Switzerland', code: 'CH', lat: 47, lon: 8 },
  MXN: { country: 'Mexico', code: 'MX', lat: 23, lon: -102 },
  COP: { country: 'Colombia', code: 'CO', lat: 4, lon: -74 },
  ZAR: { country: 'South Africa', code: 'ZA', lat: -30, lon: 25 },
  PLN: { country: 'Poland', code: 'PL', lat: 52, lon: 20 },
  SEK: { country: 'Sweden', code: 'SE', lat: 62, lon: 15 },
  PHP: { country: 'Philippines', code: 'PH', lat: 13, lon: 122 },
  VND: { country: 'Vietnam', code: 'VN', lat: 16, lon: 108 },
  THB: { country: 'Thailand', code: 'TH', lat: 15, lon: 100 },
  PKR: { country: 'Pakistan', code: 'PK', lat: 30, lon: 70 },
  KES: { country: 'Kenya', code: 'KE', lat: -1, lon: 38 },
  UAH: { country: 'Ukraine', code: 'UA', lat: 49, lon: 32 },
  IDR: { country: 'Indonesia', code: 'ID', lat: -2, lon: 118 },
};

export async function briefing() {
  try {
    const data = await safeFetch(BISQ_API, { timeout: 10000 });

    // Bisq returns offers — aggregate by fiat currency to approximate country
    const offers = Array.isArray(data) ? data : (data.offers || data.buys || []);
    if (!offers.length) return { volumes: adoptionBaseline, source: 'adoption-index' };

    const byCurrency = {};
    for (const offer of offers) {
      const currency = offer.counterCurrency || offer.currency || '';
      if (!currency || currency === 'BTC') continue;
      if (!byCurrency[currency]) byCurrency[currency] = { count: 0, volume: 0 };
      byCurrency[currency].count++;
      byCurrency[currency].volume += (offer.volume || offer.amount || 0);
    }

    const volumes = [];
    for (const [currency, agg] of Object.entries(byCurrency)) {
      const geo = currencyCountry[currency];
      if (!geo) continue;
      volumes.push({
        country: geo.country,
        code: geo.code,
        volume24h: agg.volume,
        offerCount: agg.count,
        currency,
        lat: geo.lat,
        lon: geo.lon,
      });
    }

    if (volumes.length < 3) {
      return { volumes: adoptionBaseline, source: 'adoption-index' };
    }

    return {
      volumes: volumes.sort((a, b) => b.volume24h - a.volume24h).slice(0, 20),
      source: 'bisq',
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    return { volumes: adoptionBaseline, source: 'adoption-index', error: e.message };
  }
}
```

- [ ] **Step 2: Verify module loads without errors**

```bash
cd C:/Crucix && node -e "import('./apis/sources/p2p-volume.mjs').then(m => console.log('OK:', typeof m.briefing))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
cd C:/Crucix && git add apis/sources/p2p-volume.mjs && git commit -m "feat: add p2p-volume source for country-level crypto trading activity"
```

---

## Task 5: Bitnodes Source Module

**Files:**
- Create: `C:/Crucix/apis/sources/bitnodes.mjs`

- [ ] **Step 1: Create bitnodes.mjs**

```js
// Bitnodes — Bitcoin full node geographic distribution
// Public API, no key required
// Docs: https://bitnodes.io/api/

import { safeFetch } from '../utils/fetch.mjs';

const API_BASE = 'https://bitnodes.io/api/v1';

// Country centroids for plotting
const countryCentroids = {
  US: [39, -98], DE: [51, 10], FR: [46, 2], GB: [54, -2], NL: [52, 5],
  CA: [56, -96], SG: [1.35, 103.8], JP: [36, 138], AU: [-25, 134], CH: [47, 8],
  SE: [62, 15], FI: [64, 26], NO: [62, 10], RU: [56, 38], CN: [35, 105],
  HK: [22.3, 114.2], KR: [37, 127], BR: [-14, -51], IN: [20, 78], IE: [53, -6],
  AT: [47.3, 13.3], PL: [52, 20], CZ: [50, 14], IT: [42, 12], ES: [40, -4],
  RO: [46, 25], UA: [49, 32], IL: [31.5, 35], ZA: [-30, 25], AR: [-38, -63],
  LU: [49.8, 6.1], BE: [50.8, 4.4], DK: [56, 10], PT: [39.5, -8],
  BG: [43, 25], HR: [45.2, 15.5], LT: [55.5, 24], LV: [57, 25], EE: [59, 26],
  IS: [65, -18], NZ: [-41, 174], TW: [23.5, 121], TH: [15, 100], MY: [4.2, 102],
};

export async function briefing() {
  const data = await safeFetch(`${API_BASE}/snapshots/latest/`, { timeout: 15000 });
  if (data.error) return { error: data.error, nodes: [], totalNodes: 0 };

  // API returns { total_nodes, latest_height, nodes: { "ip:port": [...] } }
  const nodeMap = data.nodes || {};
  const byCountry = {};

  for (const [, info] of Object.entries(nodeMap)) {
    // info is an array: [protocol_version, user_agent, connected_since, services, height, hostname, city, country_code, latitude, longitude, ...]
    const countryCode = Array.isArray(info) ? info[7] : info?.country_code;
    if (!countryCode) continue;
    byCountry[countryCode] = (byCountry[countryCode] || 0) + 1;
  }

  const nodes = Object.entries(byCountry)
    .map(([code, count]) => {
      const coords = countryCentroids[code];
      if (!coords) return null;
      return { country: code, code, count, lat: coords[0], lon: coords[1] };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  return {
    nodes,
    totalNodes: data.total_nodes || Object.keys(nodeMap).length,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Verify module loads without errors**

```bash
cd C:/Crucix && node -e "import('./apis/sources/bitnodes.mjs').then(m => console.log('OK:', typeof m.briefing))"
```
Expected: `OK: function`

- [ ] **Step 3: Commit**

```bash
cd C:/Crucix && git add apis/sources/bitnodes.mjs && git commit -m "feat: add bitnodes source for Bitcoin node geographic distribution"
```

---

## Task 6: Wire Sources into Briefing Orchestrator

**Files:**
- Modify: `C:/Crucix/apis/briefing.mjs`

- [ ] **Step 1: Add Tier 6 imports**

After the existing `// === Tier 5: Live Market Data ===` section (line 44), add:

```js
// === Tier 6: Crypto Geographic ===
import { briefing as whaleAlert } from './sources/whale-alert.mjs';
import { briefing as coinglass } from './sources/coinglass.mjs';
import { briefing as googleTrendsGeo } from './sources/google-trends-geo.mjs';
import { briefing as p2pVolume } from './sources/p2p-volume.mjs';
import { briefing as bitnodes } from './sources/bitnodes.mjs';
```

- [ ] **Step 2: Add sources to allPromises**

After `runSource('YFinance', yfinance),` (line 105), add:

```js
    // Tier 6: Crypto Geographic
    runSource('WhaleAlert', whaleAlert),
    runSource('CoinGlass', coinglass),
    runSource('GoogleTrendsGeo', googleTrendsGeo),
    runSource('P2PVolume', p2pVolume),
    runSource('Bitnodes', bitnodes),
```

- [ ] **Step 3: Update source count in log message**

Change line 66 from:
```js
console.error('[Crucix] Starting intelligence sweep — 27 sources...');
```
To:
```js
console.error('[Crucix] Starting intelligence sweep — 32 sources...');
```

- [ ] **Step 4: Verify briefing loads**

```bash
cd C:/Crucix && node -e "import('./apis/briefing.mjs').then(m => console.log('OK:', typeof m.fullBriefing))"
```
Expected: `OK: function`

- [ ] **Step 5: Commit**

```bash
cd C:/Crucix && git add apis/briefing.mjs && git commit -m "feat: wire 5 crypto geo sources into briefing orchestrator (Tier 6)"
```

---

## Task 7: Add Config for Crypto Fast Cycle and Trends Interval

**Files:**
- Modify: `C:/Crucix/crucix.config.mjs`

- [ ] **Step 1: Add crypto config options**

After the existing `refreshIntervalMinutes` line (line 7), add:

```js
  cryptoFastIntervalMinutes: parseFloat(process.env.CRYPTO_FAST_INTERVAL_MINUTES) || 2.5,
  trendsIntervalMinutes: parseInt(process.env.TRENDS_INTERVAL_MINUTES) || 60,
```

- [ ] **Step 2: Commit**

```bash
cd C:/Crucix && git add crucix.config.mjs && git commit -m "feat: add crypto fast cycle and trends interval config"
```

---

## Task 8: Add synthesizeCrypto() to inject.mjs

**Files:**
- Modify: `C:/Crucix/dashboard/inject.mjs`

- [ ] **Step 1: Add exchange geo-mapping table**

After the existing `geoKeywords` object (after line 83), add:

```js
// Exchange headquarters geo-coordinates for crypto transaction mapping
const exchangeGeo = {
  binance:   { lat: 1.35,  lon: 103.8,  label: 'Binance (SG)' },
  coinbase:  { lat: 37.8,  lon: -122.4, label: 'Coinbase (US)' },
  upbit:     { lat: 37.6,  lon: 127.0,  label: 'Upbit (KR)' },
  kraken:    { lat: 37.8,  lon: -122.4, label: 'Kraken (US)' },
  okx:       { lat: 1.28,  lon: 103.85, label: 'OKX (SG)' },
  bybit:     { lat: 25.2,  lon: 55.3,   label: 'Bybit (UAE)' },
  bitfinex:  { lat: 22.3,  lon: 114.2,  label: 'Bitfinex (HK)' },
  kucoin:    { lat: 1.35,  lon: 103.8,  label: 'KuCoin (SG)' },
  gate:      { lat: 1.35,  lon: 103.8,  label: 'Gate (SG)' },
  mexc:      { lat: 1.35,  lon: 103.8,  label: 'MEXC (SG)' },
  bitget:    { lat: 1.35,  lon: 103.8,  label: 'Bitget (SG)' },
  htx:       { lat: 1.35,  lon: 103.8,  label: 'HTX (SG)' },
};

function getExchangeGeo(name) {
  if (!name || name === 'unknown') return null;
  return exchangeGeo[name.toLowerCase()] || null;
}
```

- [ ] **Step 2: Add synthesizeCrypto function**

Before the `export async function synthesize(data)` function, add:

```js
function synthesizeCrypto(sources) {
  // Whale transactions with geo
  const whaleData = sources.WhaleAlert || {};
  const whales = (whaleData.transactions || []).map(tx => ({
    hash: tx.hash,
    from: tx.from?.owner || 'unknown',
    to: tx.to?.owner || 'unknown',
    symbol: tx.symbol,
    usdValue: tx.usdValue,
    fromGeo: getExchangeGeo(tx.from?.owner),
    toGeo: getExchangeGeo(tx.to?.owner),
    timestamp: tx.timestamp,
  })).filter(tx => tx.fromGeo || tx.toGeo); // only show if at least one end is mappable

  // Liquidations with exchange geo
  const cgData = sources.CoinGlass || {};
  const liqExchanges = (cgData.liquidations || []).map(l => ({
    exchange: l.exchange,
    geo: getExchangeGeo(l.exchange),
    longVol24h: l.longVolume24h,
    shortVol24h: l.shortVolume24h,
    total24h: l.total24h,
  })).filter(l => l.geo);

  const totalLong = cgData.totalLong24h || liqExchanges.reduce((s, l) => s + l.longVol24h, 0);
  const totalShort = cgData.totalShort24h || liqExchanges.reduce((s, l) => s + l.shortVol24h, 0);
  const ratio = totalLong / (totalShort || 1);
  const bias = ratio > 1.5 ? 'long-heavy' : ratio < 0.67 ? 'short-heavy' : 'balanced';
  const hotExchange = liqExchanges.sort((a, b) => b.total24h - a.total24h)[0]?.exchange || '';

  // Trends
  const trendsData = sources.GoogleTrendsGeo || {};
  const trends = (trendsData.regions || []).map(r => ({
    country: r.country, code: r.code, interest: r.interest, change: r.change,
    lat: r.lat, lon: r.lon,
  }));

  // P2P
  const p2pData = sources.P2PVolume || {};
  const p2p = (p2pData.volumes || []).map(v => ({
    country: v.country, code: v.code, volume24h: v.volume24h || v.score || 0,
    lat: v.lat, lon: v.lon,
  }));

  // Nodes
  const nodeData = sources.Bitnodes || {};
  const nodes = (nodeData.nodes || []).map(n => ({
    country: n.country, code: n.code, count: n.count,
    lat: n.lat, lon: n.lon,
  }));

  return {
    whales,
    liquidations: {
      exchanges: liqExchanges,
      totalLong24h: totalLong,
      totalShort24h: totalShort,
      bias,
      hotExchange,
    },
    trends,
    p2p,
    nodes,
    lastFastUpdate: new Date().toISOString(),
    lastFullUpdate: new Date().toISOString(),
  };
}
```

- [ ] **Step 3: Wire crypto into synthesize() output**

In the `synthesize()` function, in the `const V2 = { ... }` object (around line 556-573), add `crypto` to the output. After the `markets,` line, add:

```js
    crypto: synthesizeCrypto(data.sources),
```

- [ ] **Step 4: Verify inject.mjs loads**

```bash
cd C:/Crucix && node -e "import('./dashboard/inject.mjs').then(m => console.log('OK:', typeof m.synthesize))"
```
Expected: `OK: function`

- [ ] **Step 5: Commit**

```bash
cd C:/Crucix && git add dashboard/inject.mjs && git commit -m "feat: add synthesizeCrypto with exchange geo mapping and crypto data synthesis"
```

---

## Task 9: Add Fast Cycle and Crypto SSE Event to Server

**Files:**
- Modify: `C:/Crucix/server.mjs`

- [ ] **Step 1: Add fast-cycle source imports**

After the existing imports at the top of server.mjs (around line 16), add:

```js
import { briefing as whaleAlertBriefing } from './apis/sources/whale-alert.mjs';
import { briefing as coinglassBriefing } from './apis/sources/coinglass.mjs';
```

Note: `runSource` is already exported from `apis/briefing.mjs`. Verify with: `grep 'export.*runSource' apis/briefing.mjs`. If it is not exported, add `export` before `async function runSource` in briefing.mjs. Then import it:

```js
import { runSource } from './apis/briefing.mjs';
```

- [ ] **Step 2: Add fast-cycle state variable**

After the existing `let sweepInProgress = false;` line (around line 34), add:

```js
let cryptoFastCycleInProgress = false;
```

- [ ] **Step 3: Add runCryptoFastCycle function**

Before the `// === Startup ===` section (around line 382), add:

```js
// === Crypto Fast Cycle (whale + liquidation data, 2.5 min) ===
async function runCryptoFastCycle() {
  if (cryptoFastCycleInProgress || sweepInProgress) return;
  if (!currentData) return; // wait for first full sweep

  cryptoFastCycleInProgress = true;
  try {
    const results = await Promise.allSettled([
      runSource('WhaleAlert', whaleAlertBriefing),
      runSource('CoinGlass', coinglassBriefing),
    ]);

    const fastSources = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 'ok') {
        fastSources[r.value.name] = r.value.data;
      }
    }

    if (Object.keys(fastSources).length === 0) return;

    // Import synthesizeCrypto dynamically to avoid circular deps
    const { synthesizeCryptoFast } = await import('./dashboard/inject.mjs');

    // Merge fast sources into existing crypto data
    const existingCrypto = currentData.crypto || {};
    const fastCrypto = synthesizeCryptoFast(fastSources, existingCrypto);
    currentData.crypto = fastCrypto;

    broadcast({ type: 'crypto_update', data: currentData.crypto });
  } catch (err) {
    console.error('[Alphora World] Crypto fast cycle error:', err.message);
  } finally {
    cryptoFastCycleInProgress = false;
  }
}
```

- [ ] **Step 4: Add synthesizeCryptoFast export to inject.mjs**

In `C:/Crucix/dashboard/inject.mjs`, after the `synthesizeCrypto` function, add:

```js
// Fast-cycle variant: only updates whale + liquidation data, preserves trends/p2p/nodes from last full sweep
export function synthesizeCryptoFast(fastSources, existingCrypto) {
  const partial = synthesizeCrypto({ ...fastSources });
  return {
    whales: partial.whales.length ? partial.whales : existingCrypto.whales || [],
    liquidations: partial.liquidations.exchanges.length ? partial.liquidations : existingCrypto.liquidations || {},
    trends: existingCrypto.trends || [],
    p2p: existingCrypto.p2p || [],
    nodes: existingCrypto.nodes || [],
    lastFastUpdate: new Date().toISOString(),
    lastFullUpdate: existingCrypto.lastFullUpdate || new Date().toISOString(),
  };
}
```

- [ ] **Step 5: Schedule fast cycle in startup**

In the `start()` function, after the existing `setInterval(runSweepCycle, ...)` line (around line 445), add:

```js
    // Crypto fast cycle (whale + liquidation updates)
    setInterval(runCryptoFastCycle, config.cryptoFastIntervalMinutes * 60 * 1000);
```

- [ ] **Step 6: Update startup banner**

Update the startup banner in the `start()` function to show crypto fast cycle status. After the Discord line, add:

```js
  ║  Crypto:     Every ${config.cryptoFastIntervalMinutes} min (fast)${' '.repeat(12 - String(config.cryptoFastIntervalMinutes).length)}║
```

- [ ] **Step 7: Verify server loads**

```bash
cd C:/Crucix && node -e "import('./server.mjs')" 2>&1 | head -5
```
Expected: Server starts without import errors (will attempt to bind port)

- [ ] **Step 8: Commit**

```bash
cd C:/Crucix && git add server.mjs dashboard/inject.mjs && git commit -m "feat: add crypto fast cycle (2.5 min) for whale and liquidation data"
```

---

## Task 10: Add Crypto Layers to Globe (jarvis.html)

**Files:**
- Modify: `C:/Crucix/dashboard/public/jarvis.html`

This is the largest task — adds CSS, globe layers, and crypto-specific rendering to the monolithic dashboard.

- [ ] **Step 1: Add crypto CSS classes**

In the `<style>` section, before the closing `</style>` tag, add:

```css
/* CRYPTO LAYERS */
.ldot.crypto-whale{background:#f59e0b;box-shadow:0 0 6px rgba(245,158,11,0.4)}
.ldot.crypto-liq{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.4)}
.ldot.crypto-trend{background:#8b5cf6;box-shadow:0 0 6px rgba(139,92,246,0.4)}
.ldot.crypto-p2p{background:#10b981;box-shadow:0 0 6px rgba(16,185,129,0.4)}
.ldot.crypto-node{background:#06b6d4;box-shadow:0 0 6px rgba(6,182,212,0.4)}
.crypto-focus-btn{padding:5px 12px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;border:1px solid rgba(245,158,11,0.28);color:#f59e0b;background:rgba(245,158,11,0.07);cursor:pointer;transition:all 0.2s}
.crypto-focus-btn:hover{border-color:rgba(245,158,11,0.5);background:rgba(245,158,11,0.12)}
.crypto-focus-btn.active{color:#020408;background:#f59e0b;border-color:#f59e0b}
.osint-focus-btn{padding:5px 12px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;border:1px solid rgba(100,240,200,0.28);color:var(--accent);background:rgba(100,240,200,0.07);cursor:pointer;transition:all 0.2s}
.osint-focus-btn:hover{border-color:rgba(100,240,200,0.5);background:rgba(100,240,200,0.12)}
.osint-focus-btn.active{color:#020408;background:var(--accent);border-color:var(--accent)}
.crypto-feed-item{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;display:flex;gap:6px;align-items:baseline}
.crypto-feed-amount{font-family:var(--mono);color:#f59e0b;font-weight:600;white-space:nowrap}
.crypto-feed-route{color:var(--dim);font-size:10px}
.crypto-feed-time{color:var(--dim);font-size:10px;margin-left:auto;white-space:nowrap}
.crypto-liq-bar{display:flex;gap:8px;padding:8px;border:1px solid rgba(239,68,68,0.2);background:rgba(239,68,68,0.04);margin-bottom:6px;font-family:var(--mono);font-size:11px}
.crypto-liq-long{color:#ef4444}
.crypto-liq-short{color:#10b981}
.crypto-panel-trending{font-size:11px}
.crypto-panel-trending .trend-row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
.crypto-panel-trending .trend-country{color:var(--text)}
.crypto-panel-trending .trend-score{font-family:var(--mono);color:#8b5cf6}
.dimmed{opacity:0.1 !important;transition:opacity 0.3s}
```

- [ ] **Step 2: Add topbar focus mode buttons**

In the topbar HTML, in the `.top-center` div (where region buttons are), add the focus mode buttons before or after the region buttons:

```html
<button class="osint-focus-btn" onclick="setFocusMode('osint')" id="osintFocusBtn">OSINT</button>
<button class="crypto-focus-btn" onclick="setFocusMode('crypto')" id="cryptoFocusBtn">₿ CRYPTO</button>
```

- [ ] **Step 3: Add crypto layer state and focus mode logic**

In the `<script>` section, after the existing globe/map state variables, add:

```js
// === Crypto Layer State ===
let cryptoFocusMode = null; // null = 'all', 'osint', 'crypto'
let cryptoLayers = { whales: true, liquidations: true, trends: true, p2p: true, nodes: true };

function setFocusMode(mode) {
  if (cryptoFocusMode === mode) {
    cryptoFocusMode = null; // toggle off → back to 'all'
  } else {
    cryptoFocusMode = mode;
  }
  applyFocusMode();
}

function applyFocusMode() {
  const osintBtn = document.getElementById('osintFocusBtn');
  const cryptoBtn = document.getElementById('cryptoFocusBtn');
  osintBtn.classList.toggle('active', cryptoFocusMode === 'osint');
  cryptoBtn.classList.toggle('active', cryptoFocusMode === 'crypto');

  // Dim/show layers based on focus
  const nonCryptoLayers = document.querySelectorAll('[data-layer-group="osint"]');
  const cryptoLayerEls = document.querySelectorAll('[data-layer-group="crypto"]');

  if (cryptoFocusMode === 'crypto') {
    nonCryptoLayers.forEach(el => el.classList.add('dimmed'));
    cryptoLayerEls.forEach(el => el.classList.remove('dimmed'));
    // Show crypto panels, hide OSINT panels
    document.querySelectorAll('.osint-panel').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.crypto-panel').forEach(el => el.style.display = '');
  } else if (cryptoFocusMode === 'osint') {
    nonCryptoLayers.forEach(el => el.classList.remove('dimmed'));
    cryptoLayerEls.forEach(el => el.classList.add('dimmed'));
    document.querySelectorAll('.osint-panel').forEach(el => el.style.display = '');
    document.querySelectorAll('.crypto-panel').forEach(el => el.style.display = 'none');
  } else {
    // All mode
    nonCryptoLayers.forEach(el => el.classList.remove('dimmed'));
    cryptoLayerEls.forEach(el => el.classList.remove('dimmed'));
    document.querySelectorAll('.osint-panel').forEach(el => el.style.display = '');
    document.querySelectorAll('.crypto-panel').forEach(el => el.style.display = '');
  }
  plotMarkers(); // re-render globe with updated visibility
}

// Keyboard shortcut
document.addEventListener('keydown', e => {
  if (e.key === 'c' || e.key === 'C') {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    setFocusMode('crypto');
  }
});
```

- [ ] **Step 4: Add crypto layers to plotMarkers()**

Inside the `plotMarkers()` function, after the existing conflict rings and flight arcs code, add:

```js
  // === CRYPTO LAYERS ===
  const cryptoData = window.__data?.crypto || {};

  // Whale arcs (gold → red animated arcs between exchanges)
  if (cryptoLayers.whales) {
    const whaleArcs = (cryptoData.whales || [])
      .filter(w => w.fromGeo && w.toGeo)
      .map(w => ({
        startLat: w.fromGeo.lat, startLng: w.fromGeo.lon,
        endLat: w.toGeo.lat, endLng: w.toGeo.lon,
        color: ['#f59e0b', '#ef4444'],
        stroke: Math.max(1, Math.min(5, Math.log10(w.usdValue / 500000) * 2)),
        label: `$${(w.usdValue / 1e6).toFixed(1)}M ${w.symbol} | ${w.from} → ${w.to}`,
        type: 'crypto-whale',
        priority: 1,
      }));
    // Merge with existing arcs
    arcs.push(...whaleArcs);
  }

  // Liquidation rings (pulsing red at exchange locations)
  if (cryptoLayers.liquidations) {
    const liqRings = (cryptoData.liquidations?.exchanges || [])
      .filter(l => l.geo)
      .map(l => ({
        lat: l.geo.lat, lng: l.geo.lon,
        maxR: Math.max(1, Math.min(6, Math.log10(l.total24h / 1e6) * 2)),
        propagationSpeed: l.total24h > 100e6 ? 3 : l.total24h > 50e6 ? 2 : 1,
        repeatPeriod: l.total24h > 100e6 ? 800 : 1200,
        color: () => '#ef4444',
        label: `${l.exchange} | $${(l.longVol24h/1e6).toFixed(0)}M longs / $${(l.shortVol24h/1e6).toFixed(0)}M shorts`,
        type: 'crypto-liq',
        priority: 1,
      }));
    conflictRings.push(...liqRings);
  }

  // Search trends (violet points)
  if (cryptoLayers.trends) {
    for (const t of (cryptoData.trends || [])) {
      points.push({
        lat: t.lat, lng: t.lon,
        size: Math.max(0.3, (t.interest / 100) * 1.5),
        color: `rgba(139,92,246,${Math.max(0.3, t.interest / 100)})`,
        label: `${t.country}: ${t.interest}/100 interest${t.change ? ` (${t.change > 0 ? '+' : ''}${t.change}%)` : ''}`,
        type: 'crypto-trend',
        priority: 2,
      });
    }
  }

  // P2P volume (green points)
  if (cryptoLayers.p2p) {
    for (const p of (cryptoData.p2p || [])) {
      points.push({
        lat: p.lat, lng: p.lon,
        size: Math.max(0.3, Math.min(1.5, Math.log10(Math.max(1, p.volume24h)) * 0.3)),
        color: 'rgba(16,185,129,0.7)',
        label: `${p.country}: $${p.volume24h > 1e6 ? (p.volume24h/1e6).toFixed(1)+'M' : (p.volume24h/1e3).toFixed(0)+'K'} P2P vol`,
        type: 'crypto-p2p',
        priority: 2,
      });
    }
  }

  // Node density (cyan points)
  if (cryptoLayers.nodes) {
    for (const n of (cryptoData.nodes || [])) {
      points.push({
        lat: n.lat, lng: n.lon,
        size: Math.max(0.2, Math.min(1, Math.log10(n.count) * 0.3)),
        color: 'rgba(6,182,212,0.5)',
        label: `${n.country}: ${n.count} BTC nodes`,
        type: 'crypto-node',
        priority: 3,
      });
    }
  }
```

- [ ] **Step 5: Add crypto_update SSE handler**

In the SSE event handler (where `type === 'update'` is handled), add:

```js
if (parsed.type === 'crypto_update') {
  window.__data.crypto = parsed.data;
  plotMarkers(); // re-render crypto layers only
  updateCryptoFeed(); // refresh right rail feed
  return;
}
```

- [ ] **Step 6: Add crypto feed panel to right rail**

Add a crypto-specific panel in the right rail (hidden by default, shown in crypto focus mode):

```html
<div class="g-panel crypto-panel" style="display:none" id="cryptoFeedPanel">
  <div class="sec-head"><h3>CRYPTO FEED</h3><span class="badge" id="cryptoFeedCount">0</span></div>
  <div class="crypto-liq-bar" id="cryptoLiqBar">
    <span class="crypto-liq-long">LONGS: --</span>
    <span>|</span>
    <span class="crypto-liq-short">SHORTS: --</span>
  </div>
  <div id="cryptoFeedList" style="max-height:300px;overflow-y:auto"></div>
</div>
```

- [ ] **Step 7: Add updateCryptoFeed() function**

```js
function updateCryptoFeed() {
  const crypto = window.__data?.crypto || {};
  const list = document.getElementById('cryptoFeedList');
  const liqBar = document.getElementById('cryptoLiqBar');
  const countBadge = document.getElementById('cryptoFeedCount');
  if (!list) return;

  // Liquidation summary bar
  const liq = crypto.liquidations || {};
  if (liqBar) {
    const longM = ((liq.totalLong24h || 0) / 1e6).toFixed(0);
    const shortM = ((liq.totalShort24h || 0) / 1e6).toFixed(0);
    liqBar.innerHTML = `<span class="crypto-liq-long">LONGS: $${longM}M</span><span>|</span><span class="crypto-liq-short">SHORTS: $${shortM}M</span><span style="color:var(--dim)">(${liq.bias || 'N/A'})</span>`;
  }

  // Whale feed
  const whales = crypto.whales || [];
  if (countBadge) countBadge.textContent = whales.length;
  const now = Date.now() / 1000;
  list.innerHTML = whales.slice(0, 20).map(w => {
    const ago = Math.floor((now - w.timestamp) / 60);
    const agoText = ago < 1 ? 'now' : ago < 60 ? `${ago}m ago` : `${Math.floor(ago/60)}h ago`;
    const amtText = w.usdValue >= 1e6 ? `$${(w.usdValue/1e6).toFixed(1)}M` : `$${(w.usdValue/1e3).toFixed(0)}K`;
    return `<div class="crypto-feed-item"><span class="crypto-feed-amount">${amtText} ${w.symbol}</span><span class="crypto-feed-route">${w.from} → ${w.to}</span><span class="crypto-feed-time">${agoText}</span></div>`;
  }).join('');
}
```

- [ ] **Step 8: Add crypto layer toggles to left rail**

Add a crypto section to the left rail (hidden by default, shown in crypto focus mode):

```html
<div class="g-panel crypto-panel" style="display:none" id="cryptoLayerPanel">
  <div class="sec-head"><h3>CRYPTO LAYERS</h3></div>
  <div class="layer-item" onclick="toggleCryptoLayer('whales')"><div class="layer-left"><div class="ldot crypto-whale"></div><div><div class="layer-name">Whale Flows</div><div class="layer-sub">Exchange-to-exchange arcs</div></div></div><div class="layer-count" id="cryptoWhaleCount">0</div></div>
  <div class="layer-item" onclick="toggleCryptoLayer('liquidations')"><div class="layer-left"><div class="ldot crypto-liq"></div><div><div class="layer-name">Liquidations</div><div class="layer-sub">Exchange pulsing rings</div></div></div><div class="layer-count" id="cryptoLiqCount">0</div></div>
  <div class="layer-item" onclick="toggleCryptoLayer('trends')"><div class="layer-left"><div class="ldot crypto-trend"></div><div><div class="layer-name">Search Trends</div><div class="layer-sub">Regional interest heatmap</div></div></div><div class="layer-count" id="cryptoTrendCount">0</div></div>
  <div class="layer-item" onclick="toggleCryptoLayer('p2p')"><div class="layer-left"><div class="ldot crypto-p2p"></div><div><div class="layer-name">P2P Volume</div><div class="layer-sub">Country trading activity</div></div></div><div class="layer-count" id="cryptoP2pCount">0</div></div>
  <div class="layer-item" onclick="toggleCryptoLayer('nodes')"><div class="layer-left"><div class="ldot crypto-node"></div><div><div class="layer-name">BTC Nodes</div><div class="layer-sub">Network infrastructure</div></div></div><div class="layer-count" id="cryptoNodeCount">0</div></div>
</div>
```

Add the toggle function:

```js
function toggleCryptoLayer(layer) {
  cryptoLayers[layer] = !cryptoLayers[layer];
  plotMarkers();
}
```

- [ ] **Step 9: Add crypto trending panel to lower grid**

Add a crypto panel to the lower grid area (hidden by default):

```html
<div class="g-panel crypto-panel" style="display:none" id="cryptoTrendingPanel">
  <div class="sec-head"><h3>CRYPTO TRENDING</h3></div>
  <div class="crypto-panel-trending" id="cryptoTrendingList"></div>
</div>
```

Add update function:

```js
function updateCryptoTrending() {
  const crypto = window.__data?.crypto || {};
  const el = document.getElementById('cryptoTrendingList');
  if (!el) return;

  // Combine trends + p2p for composite score
  const combined = {};
  for (const t of (crypto.trends || [])) {
    combined[t.country] = { ...(combined[t.country] || {}), country: t.country, interest: t.interest, change: t.change };
  }
  for (const p of (crypto.p2p || [])) {
    combined[p.country] = { ...(combined[p.country] || {}), country: p.country, p2pVol: p.volume24h };
  }

  const sorted = Object.values(combined).sort((a, b) => (b.interest || 0) - (a.interest || 0)).slice(0, 10);
  el.innerHTML = sorted.map(c => {
    const changeStr = c.change ? `<span style="color:${c.change > 0 ? '#10b981' : '#ef4444'}">${c.change > 0 ? '+' : ''}${c.change}%</span>` : '';
    return `<div class="trend-row"><span class="trend-country">${c.country}</span><span class="trend-score">${c.interest || '--'}/100 ${changeStr}</span></div>`;
  }).join('');

  // Update layer counts
  const cd = crypto;
  const el2 = id => document.getElementById(id);
  if (el2('cryptoWhaleCount')) el2('cryptoWhaleCount').textContent = (cd.whales || []).length;
  if (el2('cryptoLiqCount')) el2('cryptoLiqCount').textContent = (cd.liquidations?.exchanges || []).length;
  if (el2('cryptoTrendCount')) el2('cryptoTrendCount').textContent = (cd.trends || []).length;
  if (el2('cryptoP2pCount')) el2('cryptoP2pCount').textContent = (cd.p2p || []).length;
  if (el2('cryptoNodeCount')) el2('cryptoNodeCount').textContent = (cd.nodes || []).length;
}
```

- [ ] **Step 10: Wire updateCryptoFeed and updateCryptoTrending into the main update flow**

In the existing `initUI(data)` or render function (called when SSE `update` arrives), add:

```js
updateCryptoFeed();
updateCryptoTrending();
```

- [ ] **Step 11: Tag existing OSINT panels with data-layer-group**

Add `data-layer-group="osint"` to existing left rail layer items and right rail OSINT panels. Add `data-layer-group="crypto"` to the new crypto panels. Also add `class="osint-panel"` to existing panels that should hide in crypto mode.

This is a search-and-tag operation across the existing HTML — add the attribute to:
- All existing `.layer-item` elements in the left rail
- The OSINT ticker panel in the right rail
- The news ticker, delta, macro metrics panels in the lower grid

- [ ] **Step 12: Commit**

```bash
cd C:/Crucix && git add dashboard/public/jarvis.html && git commit -m "feat: add crypto globe layers, focus mode, feed panel, and trending panel"
```

---

## Task 11: Update POBEER CrucixIntelligence Interface

**Files:**
- Modify: `C:/POBEER/src/lib/ai/data/crucix.ts`

- [ ] **Step 1: Extend CrucixIntelligence interface**

After the existing `social` field in the `CrucixIntelligence` interface (around line 30), add:

```ts
  // Crypto geographic intelligence
  crypto: {
    whales: { count: number; totalUsd: number; topFlow: string };
    liquidations: { totalLong24h: number; totalShort24h: number; bias: string };
    trendingRegions: string[];
  };
```

- [ ] **Step 2: Extract crypto data in extractIntelligence()**

In the `extractIntelligence()` function, before the `// Build summary` section, add:

```ts
  // Extract crypto geo data
  const cryptoData = data.crypto as Record<string, unknown> | undefined;
  const cryptoWhales = (cryptoData?.whales || []) as Array<{ usdValue: number; from: string; to: string; symbol: string }>;
  const cryptoLiq = cryptoData?.liquidations as Record<string, unknown> | undefined;
  const cryptoTrends = (cryptoData?.trends || []) as Array<{ country: string; interest: number }>;

  const whaleTotal = cryptoWhales.reduce((s, w) => s + (w.usdValue || 0), 0);
  const topWhale = cryptoWhales[0];
  const topFlow = topWhale
    ? `$${(topWhale.usdValue / 1e6).toFixed(1)}M ${topWhale.symbol} ${topWhale.from} → ${topWhale.to}`
    : '';
  const trendingRegions = cryptoTrends.slice(0, 3).map(t => `${t.country} (${t.interest})`);
```

- [ ] **Step 3: Add crypto to return object**

In the return object, add:

```ts
    crypto: {
      whales: { count: cryptoWhales.length, totalUsd: whaleTotal, topFlow },
      liquidations: {
        totalLong24h: (cryptoLiq?.totalLong24h as number) || 0,
        totalShort24h: (cryptoLiq?.totalShort24h as number) || 0,
        bias: (cryptoLiq?.bias as string) || 'balanced',
      },
      trendingRegions,
    },
```

- [ ] **Step 4: Add crypto to summary**

In the summary building section, add:

```ts
  if (cryptoWhales.length > 0) summaryParts.push(`${cryptoWhales.length} whale txns ($${(whaleTotal/1e6).toFixed(0)}M)`);
  if (trendingRegions.length > 0) summaryParts.push(`Crypto trending: ${trendingRegions.join(', ')}`);
```

- [ ] **Step 5: Commit**

```bash
cd C:/POBEER && git add src/lib/ai/data/crucix.ts && git commit -m "feat: extend CrucixIntelligence with crypto geo data for AI strategy context"
```

---

## Task 12: Update AI Strategy Generator Prompt

**Files:**
- Modify: `C:/POBEER/src/lib/ai/funnel/ai-generator.ts`

- [ ] **Step 1: Find where Crucix data is injected into the prompt**

Look for the section that adds Crucix intelligence to the AI prompt (around lines 215-220). After the existing Crucix context section, add:

```ts
    // Crypto geographic intelligence
    if (crucix?.crypto) {
      const c = crucix.crypto;
      parts.push(`\nCRYPTO GEO INTELLIGENCE:`);
      if (c.whales.count > 0) {
        parts.push(`- Whale flows: ${c.whales.count} transfers, $${(c.whales.totalUsd / 1e6).toFixed(0)}M total${c.whales.topFlow ? `, largest: ${c.whales.topFlow}` : ''}`);
      }
      parts.push(`- Liquidations: $${(c.liquidations.totalLong24h / 1e6).toFixed(0)}M longs / $${(c.liquidations.totalShort24h / 1e6).toFixed(0)}M shorts (bias: ${c.liquidations.bias})`);
      if (c.trendingRegions.length > 0) {
        parts.push(`- Trending regions: ${c.trendingRegions.join(', ')}`);
      }
    }
```

- [ ] **Step 2: Add crypto strategy guidance**

In the strategy design guidance section of the prompt (around lines 268-273), add:

```ts
    parts.push(`- Regional crypto demand spikes suggest local currency pressure — favor stablecoin/BTC pairs`);
    parts.push(`- Whale flow direction (exchange deposits vs withdrawals) indicates sell/accumulate pressure`);
    parts.push(`- Liquidation bias (long-heavy) suggests overleveraged longs — consider contrarian shorts`);
```

- [ ] **Step 3: Commit**

```bash
cd C:/POBEER && git add src/lib/ai/funnel/ai-generator.ts && git commit -m "feat: add crypto geo intelligence to AI strategy generation prompt"
```

---

## Task 13: End-to-End Verification

- [ ] **Step 1: Verify Crucix starts clean**

```bash
cd C:/Crucix && node server.mjs
```

Expected: Server starts, banner shows crypto fast cycle interval, initial sweep runs with 32 sources.

- [ ] **Step 2: Verify /api/data includes crypto key**

After first sweep completes, check:
```bash
curl -s http://localhost:3117/api/data | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log('crypto keys:', Object.keys(j.crypto||{}));console.log('whales:', (j.crypto?.whales||[]).length);console.log('liq exchanges:', (j.crypto?.liquidations?.exchanges||[]).length)"
```

Expected: `crypto keys: whales, liquidations, trends, p2p, nodes, lastFastUpdate, lastFullUpdate`

- [ ] **Step 3: Verify dashboard loads in browser**

Open `http://localhost:3117` — check:
- Globe renders without errors (open browser console)
- Crypto focus button appears in topbar
- Pressing `C` or clicking the button toggles focus mode
- Whale arcs appear on globe (if WHALE_ALERT_API_KEY is set and transactions exist)

- [ ] **Step 4: Verify POBEER TypeScript compiles**

```bash
cd C:/POBEER && npx tsc --noEmit
```

Expected: No type errors related to the crypto changes.

- [ ] **Step 5: Commit any fixes from verification**

```bash
cd C:/Crucix && git add -A && git commit -m "fix: address issues found during end-to-end verification"
cd C:/POBEER && git add -A && git commit -m "fix: address issues found during end-to-end verification"
```

(Skip this step if no fixes were needed.)

---

## Deferred: D3 Flat Map Crypto Layers

The spec mentions SVG-based crypto layers for the D3 flat map fallback. This plan covers the Globe.gl (3D) layers only, since the globe is the primary view. Flat map crypto layers (SVG arcs, circles, rects) can be added in a follow-up if needed — the data is already in `window.__data.crypto` so it's purely a rendering task.
