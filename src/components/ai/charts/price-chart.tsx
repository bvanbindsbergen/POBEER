"use client";

import { useEffect } from "react";
import { CandlestickSeries, HistogramSeries, createSeriesMarkers } from "lightweight-charts";
import { useChart } from "./use-chart";
import type { Trade } from "@/lib/ai/backtest/types";

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceChartProps {
  candles: Candle[];
  trades?: Trade[];
  height?: number;
}

export function PriceChart({ candles, trades, height = 400 }: PriceChartProps) {
  const { containerRef, chartRef } = useChart({ height } as Parameters<typeof useChart>[0]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    const data = candles.map((c) => ({
      time: (c.timestamp / 1000) as unknown as import("lightweight-charts").UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(data);

    // Add trade markers
    if (trades?.length) {
      const markers = trades.flatMap((t) => [
        {
          time: (t.entryTimestamp / 1000) as unknown as import("lightweight-charts").UTCTimestamp,
          position: "belowBar" as const,
          color: "#10b981",
          shape: "arrowUp" as const,
          text: `Entry $${t.entryPrice?.toFixed(2) ?? "—"}`,
        },
        {
          time: (t.exitTimestamp / 1000) as unknown as import("lightweight-charts").UTCTimestamp,
          position: "aboveBar" as const,
          color: t.pnlAbsolute >= 0 ? "#10b981" : "#ef4444",
          shape: "arrowDown" as const,
          text: `Exit $${t.exitPrice?.toFixed(2) ?? "—"}`,
        },
      ]);

      markers.sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, markers);
    }

    // Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    volumeSeries.setData(
      candles.map((c) => ({
        time: (c.timestamp / 1000) as unknown as import("lightweight-charts").UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
      }))
    );

    chart.timeScale().fitContent();

    return () => {
      try {
        chart.removeSeries(candleSeries);
        chart.removeSeries(volumeSeries);
      } catch {
        // Chart may already be destroyed by useChart cleanup
      }
    };
  }, [candles, trades, chartRef]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height }}
    />
  );
}
