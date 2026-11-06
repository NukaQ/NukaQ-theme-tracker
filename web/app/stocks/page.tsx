"use client";

import { Suspense, useMemo, useState } from "react";
import StockTable from "@/components/StockTable";
import { Chips, Loading, MarketBar, PeriodChips } from "@/components/ui";
import { useMarketData } from "@/lib/data";
import { useViewParams } from "@/lib/params";
import { MARKETS } from "@/lib/types";

const CAPS = ["all", "Mega", "Large", "Mid", "Small", "Micro"] as const;
type Scope = "all" | "index" | "themed" | "unthemed";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Stocks />
    </Suspense>
  );
}

function Stocks() {
  const { market, period, set } = useViewParams();
  const { data, error } = useMarketData(market);
  const [q, setQ] = useState("");
  const [cap, setCap] = useState<(typeof CAPS)[number]>("all");
  const [sector, setSector] = useState("");
  const [scope, setScope] = useState<Scope>("all");

  const sectors = useMemo(() => {
    if (!data) return [];
    return [...new Set(Object.values(data.stocks).map((s) => s.sector).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "ja"));
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    // 銘柄 → 所属テーマ（最下層）
    const themes: Record<string, string[]> = {};
    for (const g of data.groups) {
      if (g.level !== "theme") continue;
      for (const t of g.tickers) (themes[t] ??= []).push(g.name);
    }
    const query = q.trim().toLowerCase();
    return Object.entries(data.stocks)
      .filter(([, s]) => cap === "all" || s.capClass === cap)
      .filter(([, s]) => !sector || s.sector === sector)
      .filter(([t, s]) => scope === "all" || (scope === "index" ? s.inIndex : scope === "themed" ? !!themes[t] : !themes[t]))
      .filter(([t, s]) => !query || t.toLowerCase().includes(query) || s.name.toLowerCase().includes(query)
        || (s.sector ?? "").toLowerCase().includes(query) || themes[t]?.some((x) => x.toLowerCase().includes(query)))
      .map(([t, s]) => ({ market, ticker: t, stock: s, currency: data.currency, themes: themes[t] }));
  }, [data, q, cap, sector, scope, market]);

  const indexName = market === "jp" ? "日経225" : "S&P500";

  return (
    <>
      <div className="toolbar">
        <Chips label="市場" className="market" value={market} options={MARKETS} onChange={(m) => set({ m })} />
        <PeriodChips value={period} onChange={(p) => set({ p })} />
        <Chips label="時価総額" value={cap} onChange={setCap}
          options={CAPS.map((c) => ({ id: c, label: c === "all" ? "すべて" : c }))} />
        <select className="search" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="業種">
          <option value="">すべての業種</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Chips label="対象" value={scope} onChange={setScope} options={[
          { id: "all", label: "全銘柄" },
          { id: "index", label: `${indexName}のみ` },
          { id: "themed", label: "テーマあり" },
          { id: "unthemed", label: "テーマなし" },
        ]} />
        <input className="search" type="search" placeholder="銘柄名・ティッカー・テーマで検索" value={q}
          onChange={(e) => setQ(e.target.value)} aria-label="検索" />
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <MarketBar data={data} period={period} />
          <p className="muted small" style={{ margin: "0 0 8px" }}>{rows.length}銘柄・見出しをクリックすると並べ替えできます</p>
          {/* key で期間が変わったら並び順をその期間にリセットする */}
          <StockTable key={`${market}-${period}-${sector}`} rows={rows} period={period} showThemes />
        </>
      )}
    </>
  );
}
