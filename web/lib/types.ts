export type Market = "us" | "jp";
export type Period = "1D" | "5D" | "10D" | "1M" | "2M" | "3M" | "6M" | "1Y";
export type Level = "sector" | "subsector" | "bigTheme" | "theme";
export type Returns = Record<Period, number | null>;

export interface Group {
  id: string;
  level: Level;
  name: string;
  path: string[];
  parent: string | null;
  tickers: string[];
  returns: Returns;
  breadth: number | null;
  marketCap: number | null;
  series: (number | null)[];
  rankHistory: (number | null)[];
}

export interface Stock {
  name: string;
  sector?: string | null; // 指数一覧の業種（米国株はGICSセクター）
  industry?: string | null;
  inIndex?: boolean; // S&P500 / 日経225 の構成銘柄か
  missing?: boolean;
  close?: number;
  returns?: Returns;
  marketCap?: number | null;
  capClass?: string | null;
  high52?: number | null;
  low52?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  volRatio?: number | null;
  beta?: number | null;
  spark?: (number | null)[];
}

export interface Benchmark {
  symbol: string;
  name: string;
  returns: Returns;
  series: (number | null)[];
}

export interface MarketData {
  market: Market;
  name: string;
  currency: string;
  updatedAt: string;
  asOf: string;
  sample?: boolean;
  periods: Period[];
  dates: string[];
  benchmarks: Benchmark[];
  groups: Group[];
  stocks: Record<string, Stock>;
}

export const PERIODS: Period[] = ["1D", "5D", "10D", "1M", "2M", "3M", "6M", "1Y"];
export const PERIOD_DAYS: Record<Period, number> = {
  "1D": 1, "5D": 5, "10D": 10, "1M": 21, "2M": 42, "3M": 63, "6M": 126, "1Y": 252,
};
export const LEVELS: { id: Level; label: string }[] = [
  { id: "sector", label: "セクター" },
  { id: "subsector", label: "サブセクター" },
  { id: "bigTheme", label: "大テーマ" },
  { id: "theme", label: "テーマ" },
];
export const MARKETS: { id: Market; label: string }[] = [
  { id: "us", label: "米国株" },
  { id: "jp", label: "日本株" },
];

// ---- 銘柄ページ

export interface Technicals {
  maWindows: number[];
  maDev: Record<string, number | null>;
  maOrder: string | null;
  maCross: string | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  macdCross: string | null;
  bbPos: number | null;
  high52: number | null;
  low52: number | null;
  fromHigh52: number | null;
  high60: number | null;
  low60: number | null;
  volRatio: number | null;
  volatility: number | null;
}

export interface StockDetail {
  ticker: string;
  market: Market;
  asOf: string;
  dates: string[];
  close: (number | null)[];
  volume: (number | null)[];
  technicals: Technicals;
}

export type Action = "買い" | "やや買い" | "中立" | "やや売り" | "売り";

export interface AnalysisNewsItem {
  index: number;
  titleJa: string;
  sentiment: "好材料" | "悪材料" | "中立";
  title: string;
  url: string | null;
  date: string;
  publisher: string | null;
}

export interface Analysis {
  ticker: string;
  market: Market;
  name: string;
  analyzedAt: string;
  asOf: string;
  priceAtAnalysis: number | null;
  model: string;
  facts: {
    profile: Record<string, string>;
    fundamentals: Record<string, number>;
    analyst: Record<string, number | string>;
    earnings: {
      history?: { date: string; epsEstimate: number | null; epsActual: number | null; surprisePct: number | null }[];
      next?: { date?: string; epsEstimate?: number | null; revenueEstimate?: number | null };
      quarterly?: Record<string, number | string | null>[];
    };
    news: { title: string; summary: string; date: string; publisher: string | null; url: string | null }[];
  };
  ai: {
    headline: string;
    technical: { summary: string; trend: string; signals: string[]; support: number; resistance: number };
    fundamental: { summary: string; valuation: string; strengths: string[]; risks: string[] };
    earnings: { summary: string; lastResult: string; nextFocus: string };
    news: { summary: string; items: AnalysisNewsItem[] };
    rating: { stars: 1 | 2 | 3 | 4 | 5; reason: string };
    targetPrice: { price: number; basis: string; upsidePct: number | null };
    verdict: { action: Action; reason: string };
  };
}

/** 銘柄一覧の表に出すAI解析の要約 */
export interface AnalysisSummary {
  stars: number;
  action: Action;
  target: number;
  upside: number | null;
  analyzedAt: string;
  nextEarnings: string | null;
}
