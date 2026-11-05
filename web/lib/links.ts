import type { Market } from "./types";

/** 銘柄の詳細を見られる外部ページ（Yahoo!ファイナンス）。 */
export function quoteUrl(market: Market, ticker: string): string {
  return market === "jp"
    ? `https://finance.yahoo.co.jp/quote/${encodeURIComponent(ticker)}`
    : `https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}`;
}
