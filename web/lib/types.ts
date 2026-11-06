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
