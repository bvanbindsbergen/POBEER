"use client";

import { useRef, useEffect, useCallback } from "react";
import { createChart, type IChartApi, type DeepPartial, type ChartOptions } from "lightweight-charts";

const DARK_THEME: DeepPartial<ChartOptions> = {
  layout: {
    background: { color: "#111827" },
    textColor: "#94a3b8",
    fontSize: 12,
  },
  grid: {
    vertLines: { color: "rgba(255,255,255,0.04)" },
    horzLines: { color: "rgba(255,255,255,0.04)" },
  },
  crosshair: {
    vertLine: { color: "rgba(16,185,129,0.3)", width: 1 },
    horzLine: { color: "rgba(16,185,129,0.3)", width: 1 },
  },
  timeScale: {
    borderColor: "rgba(255,255,255,0.06)",
    timeVisible: true,
  },
  rightPriceScale: {
    borderColor: "rgba(255,255,255,0.06)",
  },
};

export function useChart(options?: DeepPartial<ChartOptions>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const initChart = useCallback(() => {
    if (!containerRef.current) return null;

    // Clean up existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(containerRef.current, {
      ...DARK_THEME,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 400,
      ...options,
    });

    chartRef.current = chart;

    // Handle resize
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [options]);

  useEffect(() => {
    const cleanup = initChart();
    return () => cleanup?.();
  }, [initChart]);

  return { containerRef, chartRef };
}
