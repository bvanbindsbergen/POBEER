# Crucix Crypto Geo Activity Map — Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Repo:** https://github.com/bvanbindsbergen/Crucix (fork)
**Integration:** POBEER (`src/lib/ai/data/crucix.ts`)

## Overview

Add a geographic crypto activity visualization layer to the Crucix OSINT dashboard. Five new data sources render as interactive layers on the existing Globe.gl/D3 map, with a dedicated "Crypto Focus Mode" that provides a first-class crypto intelligence view alongside the existing geopolitical/market layers.

## Architecture: Bolt-On Sources (Approach A)

Follow the existing Crucix pattern: each data source is an independent module in `apis/sources/` exporting an async `briefing()` function. A new fast-cycle timer in `server.mjs` handles time-sensitive crypto sources independently from the 15-minute full sweep.

---

## Section 1: Data Sources & Source Modules

### 5 new source files in `apis/sources/`

| Module | API | Auth | Refresh Cycle | Key |
|---|---|---|---|---|
| `whale-alert.mjs` | Whale Alert REST API | `WHALE_ALERT_API_KEY` (env) | Fast (2.5 min) | Existing env var |
| `coinglass.mjs` | CoinGlass public API | None (rate-limited) | Fast (2.5 min) | — |
| `google-trends-geo.mjs` | SerpAPI (Google Trends) | `SERPAPI_KEY` (env) | Normal (60 min) | Existing in POBEER; 60-min default to stay within free tier |
| `p2p-volume.mjs` | Bisq public API (offers endpoint) + Paxful (if available) | None | Normal (15 min) | Aggregate country-level volume from trade offers; fallback to hardcoded adoption index if APIs lack geo breakdown |
| `bitnodes.mjs` | Bitnodes.io public API | None | Normal (15 min) | — |

### Source Output Schemas

**whale-alert.mjs:**
```js
{
  transactions: [{
    hash: string,
    from: { owner: string, ownerType: 'exchange'|'unknown' },
    to: { owner: string, ownerType: 'exchange'|'unknown' },
    amount: number,
    symbol: 'BTC'|'ETH'|'USDT'|...,
    usdValue: number,
    timestamp: number  // unix seconds
  }]
}
```

**coinglass.mjs:**
```js
{
  liquidations: [{
    exchange: string,       // 'Binance', 'OKX', 'Bybit', etc.
    symbol: string,         // 'BTC', 'ETH'
    longVolume24h: number,  // USD
    shortVolume24h: number,
    total24h: number
  }],
  openInterest: {
    btc: number,
    eth: number,
    total: number
  }
}
```

**google-trends-geo.mjs:**
```js
{
  regions: [{
    country: string,    // 'Nigeria'
    code: string,       // 'NG'
    interest: number,   // 0-100
    change: number,     // % change vs previous period
    lat: number,
    lon: number
  }]
}
```

**p2p-volume.mjs:**
```js
{
  volumes: [{
    country: string,
    code: string,
    volume24h: number,  // USD equivalent
    currency: string,   // local currency code
    lat: number,
    lon: number
  }]
}
```

**bitnodes.mjs:**
```js
{
  nodes: [{
    country: string,
    code: string,
    count: number,
    lat: number,
    lon: number
  }],
  totalNodes: number
}
```

### Source Pattern

Each module follows the existing convention:
```js
import '../utils/env.mjs';

export async function briefing() {
  // Fetch with AbortController timeout
  // Return structured data
  // Graceful failure: return { error: message } or throw
}
```

---

## Section 2: Server Architecture — Dual Timer

### server.mjs Changes

**New fast-cycle timer** added alongside existing 15-min sweep:

```
Existing:  setInterval(runSweepCycle, 15 * 60 * 1000)     // all 30 sources
New:       setInterval(runCryptoFastCycle, 2.5 * 60 * 1000) // whale-alert + coinglass only
```

### runCryptoFastCycle()

- Runs `whale-alert.mjs` and `coinglass.mjs` in parallel via `Promise.allSettled()`
- Merges results into `currentData.crypto` (whale + liquidation fields only)
- Broadcasts `{ type: 'crypto_update', data: currentData.crypto }` via SSE
- Does NOT trigger delta computation or LLM ideas
- Skips execution if `sweepInProgress === true` (avoids race conditions)
- Independent flag: `cryptoFastCycleInProgress` prevents overlapping fast cycles

### briefing.mjs Changes

Add 3 new sources to the normal full sweep (Tier 6: Crypto Geo):

```js
// === Tier 6: Crypto Geographic ===
import { briefing as googleTrendsGeo } from './sources/google-trends-geo.mjs';
import { briefing as p2pVolume } from './sources/p2p-volume.mjs';
import { briefing as bitnodes } from './sources/bitnodes.mjs';

// In allPromises array:
runSource('GoogleTrendsGeo', googleTrendsGeo),
runSource('P2PVolume', p2pVolume),
runSource('Bitnodes', bitnodes),
```

Whale Alert and CoinGlass also run in the full sweep (for complete data) but their fast-cycle results take priority for freshness.

### inject.mjs Changes

New `synthesizeCrypto(sources)` function:

**Exchange geo-mapping table:**
```js
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
  unknown:   null  // no arc drawn for unknown wallets
};
```

**Output — new `crypto` key in `/api/data` response:**
```js
crypto: {
  whales: [{
    hash: string,
    from: string,          // exchange name or 'unknown'
    to: string,
    symbol: string,
    usdValue: number,
    fromGeo: { lat, lon, label } | null,
    toGeo: { lat, lon, label } | null,
    timestamp: number
  }],
  liquidations: {
    exchanges: [{
      exchange: string,
      geo: { lat, lon, label },
      longVol24h: number,
      shortVol24h: number,
      total24h: number
    }],
    totalLong24h: number,
    totalShort24h: number,
    bias: 'long-heavy' | 'short-heavy' | 'balanced',
    hotExchange: string   // exchange with highest total
  },
  trends: [{
    country: string,
    code: string,
    interest: number,
    change: number,
    lat: number,
    lon: number
  }],
  p2p: [{
    country: string,
    code: string,
    volume24h: number,
    lat: number,
    lon: number
  }],
  nodes: [{
    country: string,
    code: string,
    count: number,
    lat: number,
    lon: number
  }],
  lastFastUpdate: string,   // ISO timestamp
  lastFullUpdate: string
}
```

---

## Section 3: Globe Visualization — Crypto Layers

### 5 New Layers on the Existing Globe

All layers are added to the existing `plotMarkers()` function in `jarvis.html`.

| Layer | Globe.gl Method | Visual | Color | Priority |
|---|---|---|---|---|
| Whale Arcs | `globe.arcsData()` | Animated arcs between exchanges | Gold (#f59e0b) → Red (#ef4444) gradient | 1 (always visible) |
| Liquidation Rings | `globe.ringsData()` | Pulsing rings at exchange locations | Red (#ef4444), intensity scales with imbalance | 1 (always visible) |
| Search Trends | `globe.htmlElementsData()` | Translucent circles per country | Violet (#8b5cf6), opacity = interest score | 2 (mid-zoom) |
| P2P Volume | `globe.htmlElementsData()` | Vertical bars at country centroids | Green (#10b981), intensity = growth rate | 2 (mid-zoom) |
| Node Density | `globe.pointsData()` | Small dots at country centroids | Cyan (#06b6d4), size = node count | 3 (close zoom only) |

### Whale Arc Details

- Arc source/destination = exchange geo coordinates from mapping table
- Arc thickness proportional to USD value (log scale: $500k = thin, $50M+ = thick)
- Arc color: gold at source, red at destination (gradient)
- Animation: head travels along arc path from source to destination
- Arcs where both from and to are `unknown` are not rendered
- Arcs persist for 15 minutes, then fade out
- Popup on hover: `$12.4M BTC | Binance → Coinbase | 3m ago`

### Liquidation Ring Details

- Positioned at exchange headquarters (from exchangeGeo table)
- Ring radius proportional to 24h liquidation volume (log scale)
- Pulse speed increases with volume (high liq = faster pulse)
- Red intensity scales with long/short ratio imbalance
- Popup on hover: `Binance | $142M longs / $38M shorts | 24h`

### Zoom-Aware Priority

Following existing marker priority system in `plotMarkers()`:
- **Priority 1** (always visible): Whale arcs, Liquidation rings
- **Priority 2** (visible at mid-zoom): Search trends, P2P volume
- **Priority 3** (close zoom only): Node density

### D3 Flat Map Fallback

Same layers rendered as SVG on the flat D3 map:
- Arcs → SVG curved paths with CSS animation
- Rings → SVG circles with CSS pulse animation
- Trends/P2P/Nodes → SVG circles/rects at projected coordinates

---

## Section 4: Crypto Focus Mode

### Topbar Toggle

New button group in the topbar:
```
[🌍 OSINT]  [₿ Crypto]
```

- Mutually exclusive focus modes, plus neutral "All" state (default — both buttons appear unselected/dimmed)
- Clicking active mode returns to "All" (button deselects)
- Active button gets a bright border + filled background; inactive buttons are ghost/outline style
- Keyboard shortcut: `C` toggles crypto focus

### Focus Mode Behavior

**When Crypto focus activates:**

1. **Globe**: All non-crypto layers (air traffic, thermal, maritime, nuclear, conflicts, news, etc.) fade to 10% opacity. Crypto layers boost to full visibility regardless of zoom.

2. **Left Rail** swaps to crypto controls:
   - Layer toggles: Whales / Liquidations / Trends / P2P / Nodes (individual on/off)
   - Whale filter slider: min USD value ($500k → $50M)
   - Exchange filter: checkboxes to show/hide specific exchanges

3. **Right Rail** replaces OSINT ticker with Crypto Feed:
   - Live whale transaction stream (latest 20, auto-scrolling)
   - Format: `[whale emoji] $12.4M BTC | Binance → Coinbase | 2m ago`
   - Liquidation summary bar at top: `[explosion emoji] $142M longs / $38M shorts (24h)`
   - Color-coded: green for exchange→unknown (withdrawals), red for unknown→exchange (deposits)

4. **Lower Grid** replaces one panel with Crypto Panel:
   - Top trending countries (combined search interest + P2P score)
   - Regional premium indicators (if available)
   - BTC/ETH node count summary
   - Liquidation bias indicator (long-heavy / short-heavy / balanced)

**When Crypto focus deactivates:**
- All layers return to normal opacity
- Left rail, right rail, lower grid revert to default OSINT view
- Crypto layers remain visible at their normal priority levels

### SSE Event Handling

`jarvis.html` listens for the new `crypto_update` event type:
```js
// Existing:
if (event.type === 'update') { /* full reinit */ }
// New:
if (event.type === 'crypto_update') { /* update crypto layers only, no full reinit */ }
```

This ensures fast-cycle crypto updates don't cause a full dashboard re-render.

---

## Section 5: POBEER Integration Update

### crucix.ts Changes

Extend `CrucixIntelligence` interface:
```ts
crypto: {
  whales: { count: number; totalUsd: number; topFlow: string };
  liquidations: { totalLong24h: number; totalShort24h: number; bias: string };
  trendingRegions: string[];  // top 3 countries by search interest
};
```

Extract from `data.crypto` in `extractIntelligence()`.

### ai-generator.ts Changes

Add to the AI strategy generation prompt context:
```
CRYPTO GEO INTELLIGENCE:
- Whale flows: {count} transfers, ${totalUsd} total, largest: {topFlow}
- Liquidations: ${totalLong24h} longs / ${totalShort24h} shorts (bias: {bias})
- Trending regions: {trendingRegions joined}
```

Add to strategy guidance:
```
- Regional crypto demand spikes suggest local currency pressure — favor stablecoin/BTC pairs
- Whale flow direction (exchange deposits vs withdrawals) indicates sell/accumulate pressure
- Liquidation bias (long-heavy) suggests overleveraged longs — consider contrarian shorts
```

### No Other POBEER Changes

The iframe embed (`/world` page) continues to work as-is — it points to the Crucix dashboard which will now render crypto layers natively.

---

## File Summary

### Crucix Repo (new files)

| File | Purpose |
|---|---|
| `apis/sources/whale-alert.mjs` | Whale Alert API source module |
| `apis/sources/coinglass.mjs` | CoinGlass liquidation/OI source module |
| `apis/sources/google-trends-geo.mjs` | Google Trends by region via SerpAPI |
| `apis/sources/p2p-volume.mjs` | Bisq + Hodl Hodl P2P volumes |
| `apis/sources/bitnodes.mjs` | Bitcoin node geographic distribution |

### Crucix Repo (modified files)

| File | Changes |
|---|---|
| `apis/briefing.mjs` | Add Tier 6 imports + 3 new sources to allPromises |
| `server.mjs` | Add `runCryptoFastCycle()`, fast interval, crypto_update SSE event |
| `dashboard/inject.mjs` | Add `synthesizeCrypto()`, exchange geo table, crypto key in output |
| `dashboard/public/jarvis.html` | Add 5 globe layers, crypto focus mode, topbar toggle, crypto panels |

### POBEER Repo (modified files)

| File | Changes |
|---|---|
| `src/lib/ai/data/crucix.ts` | Extend CrucixIntelligence with crypto field |
| `src/lib/ai/funnel/ai-generator.ts` | Add crypto geo context to AI prompt |

---

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `WHALE_ALERT_API_KEY` | Yes | Already exists in env |
| `SERPAPI_KEY` | Optional | Already exists in POBEER; add to Crucix .env |
| No new keys required for CoinGlass, Bisq, Bitnodes | — | Public APIs |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Whale Alert free tier rate limit (10 req/min) | 2.5 min cycle = 1 req per cycle, well within limit |
| CoinGlass rate limiting (no published limits) | Respect 429 responses, exponential backoff, cache last good response |
| SerpAPI 100/mo free tier | Default to 60-min cycle (~48 calls/day); configurable via `TRENDS_INTERVAL_MINUTES` env var; upgrade to paid tier for 15-min resolution |
| jarvis.html growing larger | Crypto UI code is additive (new layers + panels), no existing code restructuring needed |
| Exchange geo mapping inaccuracy | Best-effort based on HQ locations; exchanges are global but HQ gives directional signal |
| P2P API geo data availability | Bisq/Paxful may not expose country-level volume; fallback to Chainalysis adoption index as static baseline layer |
