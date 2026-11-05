"use client";

import { useEffect, useState } from "react";
import type { Market, MarketData } from "./types";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const cache = new Map<Market, Promise<MarketData>>();

function load(market: Market): Promise<MarketData> {
  let p = cache.get(market);
  if (!p) {
    p = fetch(`${BASE}/data/${market}.json`, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`データを読み込めませんでした (${r.status})`);
      return r.json();
    });
    p.catch(() => cache.delete(market));
    cache.set(market, p);
  }
  return p;
}

/** 市場ごとのデータ（web/public/data/{market}.json）を読み込む。 */
export function useMarketData(market: Market) {
  const [data, setData] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    load(market)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [market]);

  return { data, error };
}
