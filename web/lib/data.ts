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

// ---- 銘柄ページ・AI解析

const jsonCache = new Map<string, Promise<unknown>>();

/** JSONを読む。ファイルがなければ null（まだAI解析していない銘柄など）。 */
function loadJson<T>(path: string): Promise<T | null> {
  let p = jsonCache.get(path) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(`${BASE}${path}`, { cache: "no-cache" }).then((r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`データを読み込めませんでした (${r.status})`);
      return r.json();
    });
    p.catch(() => jsonCache.delete(path));
    jsonCache.set(path, p);
  }
  return p;
}

export function useJson<T>(path: string | null) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null; done: boolean }>({
    path: null, data: null, error: null, done: false,
  });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    loadJson<T>(path)
      .then((d) => alive && setState({ path, data: d, error: null, done: true }))
      .catch((e) => alive && setState({ path, data: null, error: String(e.message || e), done: true }));
    return () => {
      alive = false;
    };
  }, [path]);
  if (state.path === path) return state;
  // 同じファイルの読み直し（?v= 付き）の間は、前の内容を表示したままにする
  const same = state.path && path && state.path.split("?")[0] === path.split("?")[0];
  return same ? { ...state, path } : { path, data: null, error: null, done: false };
}

/** 銘柄一覧の表に出すAI解析の要約（米国株・日本株の両方）。 */
export function useAnalysisSummaries() {
  const us = useJson<Record<string, import("./types").AnalysisSummary>>("/analysis/us.json");
  const jp = useJson<Record<string, import("./types").AnalysisSummary>>("/analysis/jp.json");
  return { us: us.data ?? {}, jp: jp.data ?? {} };
}

export const fileName = (ticker: string) => encodeURIComponent(ticker);
