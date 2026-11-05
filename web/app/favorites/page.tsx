"use client";

import Link from "next/link";
import { Suspense } from "react";
import StockTable, { type StockRow } from "@/components/StockTable";
import { HeatCell, Loading, PeriodChips, Star } from "@/components/ui";
import { useMarketData } from "@/lib/data";
import { useFavorites } from "@/lib/favorites";
import { useViewParams, withView } from "@/lib/params";
import { PERIODS, type Group, type Market, type MarketData } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Favorites />
    </Suspense>
  );
}

function Favorites() {
  const { period, set } = useViewParams();
  const us = useMarketData("us");
  const jp = useMarketData("jp");
  const { fav, toggle } = useFavorites();
  const all: Record<Market, MarketData | null> = { us: us.data, jp: jp.data };

  if (!us.data || !jp.data) return <Loading error={us.error || jp.error} />;

  const split = (k: string) => {
    const i = k.indexOf(":");
    return [k.slice(0, i) as Market, k.slice(i + 1)] as const;
  };
  const groups = fav.groups
    .map((k) => {
      const [m, id] = split(k);
      const g = all[m]?.groups.find((x) => x.id === id);
      return g ? { m, g } : null;
    })
    .filter((x): x is { m: Market; g: Group } => !!x);
  const stocks: StockRow[] = fav.stocks
    .map((k) => {
      const [m, t] = split(k);
      const d = all[m];
      return d?.stocks[t] ? { market: m, ticker: t, stock: d.stocks[t], currency: d.currency } : null;
    })
    .filter((x): x is StockRow => !!x);

  return (
    <>
      <h1>お気に入り</h1>
      <p className="muted small">☆ を押したテーマと銘柄がここに並びます。お気に入りはこのブラウザだけに保存されます。</p>
      <div className="toolbar"><PeriodChips value={period} onChange={(p) => set({ p })} /></div>

      <h2>テーマ</h2>
      {groups.length === 0 ? <div className="panel empty">まだありません。ランキングで ☆ を押してください。</div> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th></th><th>テーマ</th>{PERIODS.map((p) => <th key={p} className="num">{p}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map(({ m, g }) => (
                <tr key={`${m}:${g.id}`}>
                  <td><Star on onClick={() => toggle("groups", `${m}:${g.id}`)} label={g.name} /></td>
                  <td className="name-cell">
                    <Link href={withView("/theme/", m, { id: g.id, p: period })}>{g.name}</Link>
                    <span className="path">{m === "jp" ? "日本株" : "米国株"}{g.path.length > 1 ? `・${g.path.slice(0, -1).join(" › ")}` : ""}</span>
                  </td>
                  {PERIODS.map((p) => <HeatCell key={p} v={g.returns[p]} period={p} strong={p === period} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>銘柄</h2>
      {stocks.length === 0 ? <div className="panel empty">まだありません。銘柄の表で ☆ を押してください。</div> : (
        <StockTable key={period} rows={stocks} period={period} showMarket />
      )}
    </>
  );
}
