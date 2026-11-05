"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect } from "react";
import { LEVELS, PERIODS, type Level, type Market, type Period } from "./types";

const MARKET_KEY = "tt:market";

/**
 * 市場・期間・階層を URL の ?m=&p=&lv= に持たせる。
 * URLを共有すれば同じ表示を開ける。市場は最後に選んだものを覚えておく。
 */
export function useViewParams(defaults: { period?: Period; level?: Level } = {}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const mParam = sp.get("m");
  const market: Market = mParam === "jp" || mParam === "us" ? mParam : "us";
  const pParam = sp.get("p") as Period | null;
  const period: Period = pParam && PERIODS.includes(pParam) ? pParam : defaults.period ?? "1D";
  const lvParam = sp.get("lv") as Level | null;
  const level: Level = lvParam && LEVELS.some((l) => l.id === lvParam) ? lvParam : defaults.level ?? "theme";

  // URLに市場がないときは、前回選んだ市場に切り替える
  useEffect(() => {
    if (mParam) {
      try { localStorage.setItem(MARKET_KEY, mParam); } catch {}
      return;
    }
    let saved: string | null = null;
    try { saved = localStorage.getItem(MARKET_KEY); } catch {}
    if (saved === "jp") {
      const q = new URLSearchParams(sp.toString());
      q.set("m", "jp");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    }
  }, [mParam, sp, router, pathname]);

  const set = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) q.delete(k);
        else q.set(k, v);
      }
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  return { market, period, level, sp, set };
}

/** 他のページへのリンクに、今の市場と期間を引き継ぐ。 */
export function withView(path: string, market: Market, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ m: market, ...extra });
  return `${path}?${q.toString()}`;
}
