import type { Period } from "./types";

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtCap(v: number | null | undefined, currency: string): string {
  if (!v) return "—";
  if (currency === "JPY") {
    if (v >= 1e12) return `${(v / 1e12).toFixed(1)}兆円`;
    return `${Math.round(v / 1e8).toLocaleString("ja-JP")}億円`;
  }
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  return `$${Math.round(v / 1e6)}M`;
}

// 期間ごとに「これくらい動いたら色を最も濃くする」幅（%）
const SCALE: Record<Period, number> = {
  "1D": 3, "5D": 6, "10D": 8, "1M": 12, "2M": 16, "3M": 20, "6M": 30, "1Y": 50,
};

/** 騰落率を背景色に変える。上昇・下落の色はCSS変数（--up / --down）で決まる。 */
export function heat(v: number | null | undefined, period: Period): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "transparent";
  const t = Math.min(1, Math.abs(v) / SCALE[period]);
  const alpha = Math.round((0.12 + 0.78 * Math.sqrt(t)) * 100);
  const color = v >= 0 ? "var(--up)" : "var(--down)";
  return `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
}

export function signClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "up" : "down";
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** AIの売買判断に合わせた色の名前（CSSの .good / .bad / .neutral） */
export function actionClass(a: string): string {
  return a === "買い" || a === "やや買い" ? "good" : a === "売り" || a === "やや売り" ? "bad" : "neutral";
}
