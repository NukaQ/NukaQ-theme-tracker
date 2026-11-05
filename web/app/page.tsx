"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Chips, HeatCell, Loading, MarketBar, PeriodChips, Star } from "@/components/ui";
import { useMarketData } from "@/lib/data";
import { useFavorites } from "@/lib/favorites";
import { useViewParams, withView } from "@/lib/params";
import { LEVELS, MARKETS, PERIODS, type Group, type Period } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Ranking />
    </Suspense>
  );
}

function Ranking() {
  const { market, period, level, set } = useViewParams();
  const { data, error } = useMarketData(market);
  const { fav, toggle } = useFavorites();
  const router = useRouter();
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = data.groups.filter((g) => g.level === level);
    const val = (g: Group) => g.returns[period] ?? (asc ? Infinity : -Infinity);
    return [...list].sort((a, b) => (asc ? val(a) - val(b) : val(b) - val(a)));
  }, [data, level, period, asc]);

  const sortBy = (p: Period) => {
    if (p === period) setAsc(!asc);
    else {
      setAsc(false);
      set({ p });
    }
  };

  return (
    <>
      <div className="toolbar">
        <Chips label="市場" className="market" value={market} options={MARKETS} onChange={(m) => set({ m })} />
        <Chips label="階層" value={level} options={LEVELS} onChange={(lv) => set({ lv })} />
        <PeriodChips value={period} onChange={(p) => { setAsc(false); set({ p }); }} />
      </div>

      {!data ? <Loading error={error} /> : (
        <>
          <MarketBar data={data} period={period} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="rank">#</th>
                  <th></th>
                  <th>{LEVELS.find((l) => l.id === level)?.label}</th>
                  {PERIODS.map((p) => (
                    <th key={p} className={`num sortable${p === period ? " sorted" : ""}`} onClick={() => sortBy(p)}
                      title="クリックで並べ替え">
                      {p}{p === period ? (asc ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                  <th className="hide-sm" title="今日上がった銘柄の割合">上昇率</th>
                  <th className="hide-sm" title="直近20日の順位（1M騰落率）。棒が高いほど上位">過去順位</th>
                  <th className="num hide-sm">銘柄数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => {
                  const key = `${market}:${g.id}`;
                  const href = withView("/theme/", market, { id: g.id, p: period });
                  return (
                    <tr key={g.id} className="clickable" onClick={() => router.push(href)}>
                      <td className="rank num">{i + 1}</td>
                      <td><Star on={fav.groups.includes(key)} onClick={() => toggle("groups", key)} label={g.name} /></td>
                      <td className="name-cell">
                        <Link href={href} onClick={(e) => e.stopPropagation()}>{g.name}</Link>
                        {g.path.length > 1 && <span className="path">{g.path.slice(0, -1).join(" › ")}</span>}
                      </td>
                      {PERIODS.map((p) => <HeatCell key={p} v={g.returns[p]} period={p} strong={p === period} />)}
                      <td className="hide-sm">
                        <span className="breadth"><span style={{ width: `${g.breadth ?? 0}%` }} /></span>
                        <span className="small muted">{g.breadth ?? "—"}%</span>
                      </td>
                      <td className="hide-sm"><RankHistory ranks={g.rankHistory} total={rows.length} /></td>
                      <td className="num hide-sm muted">{g.tickers.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function RankHistory({ ranks, total }: { ranks: (number | null)[]; total: number }) {
  const last = ranks.filter((r) => r !== null).at(-1);
  return (
    <span title={`現在 ${last ?? "—"}位 / ${total}`} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <span className="rankhist">
        {ranks.map((r, i) => (
          <span key={i} style={{ height: r ? `${Math.max(2, ((total - r + 1) / total) * 18)}px` : "1px" }} />
        ))}
      </span>
      <span className="small muted num">{last ?? "—"}位</span>
    </span>
  );
}
