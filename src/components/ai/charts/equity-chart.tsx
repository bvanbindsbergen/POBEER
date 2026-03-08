"use client";

import { useEffect } from "react";
import { AreaSeries } from "lightweight-charts";
import { useChart } from "./use-chart";
import type { EquityPoint } from "@/lib/ai/backtest/types";

interface EquityChartProps {
  equityCurve: EquityPoint[];
  height?: number;
}

export function EquityChart({ equityCurve, height = 250 }: EquityChartProps) {
  const { containerRef, chartRef } = useChart({ height } as Parameters<typeof useChart>[0]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || equityCurve.length === 0) return;

    const initial = equityCurve[0].equity;
    const final = equityCurve[equityCurve.length - 1].equity;
    const isPositive = final >= initial;

    const lineSeries = chart.addSeries(AreaSeries, {
      lineColor: isPositive ? "#10b981" : "#ef4444",
      topColor: isPositive ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)",
      bottomColor: isPositive ? "rgba(16,185,129,0.02)" : "rgba(239,68,68,0.02)",
      lineWidth: 2,
    });

    lineSeries.setData(
      equityCurve.map((p) => ({
        time: (p.timestamp / 1000) as unknown as import("lightweight-charts").UTCTimestamp,
        value: p.equity,
      }))
    );

    chart.timeScale().fitContent();

    return () => {
      try {
        chart.removeSeries(lineSeries);
      } catch {
        // Chart may already be destroyed by useChart cleanup
      }
    };
  }, [equityCurve, chartRef]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height }}
    />
  );
}
