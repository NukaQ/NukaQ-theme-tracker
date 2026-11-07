"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { HeatCell, Pct, Sparkline, Star } from "@/components/ui";
import { useAnalysisSummaries } from "@/lib/data";
import { useFavorites } from "@/lib/favorites";
import { actionClass, fmtCap, fmtNum } from "@/lib/format";
import { stockHref } from "@/lib/links";
import { PERIODS, type Market, type Period, type Stock } from "@/lib/types";

export interface StockRow {
  market: Market;
  ticker: string;
  stock: Stock;
  currency: string;
  themes?: string[];
}

const ACTION_SCORE: Record<string, number> = { 買い: 5, やや買い: 4, 中立: 3, やや売り: 2, 売り: 1 };

type Col = { id: string; label: string; title?: string; get: (r: StockRow) => number | string | null | undefined; cls?: string };

export default function StockTable({ rows, period, showThemes = false, showMarket = false }: {
  rows: StockRow[];
  period: Period;
  showThemes?: boolean;
  showMarket?: boolean;
}) {
  const { fav, toggle } = useFavorites();
  const ai = useAnalysisSummaries();
  const sum = (r: StockRow) => ai[r.market][r.ticker];
  const [sort, setSort] = useState<{ id: string; asc: boolean }>({ id: `r:${period}`, asc: false });

  const cols: Col[] = [
    { id: "stars", label: "AI評価", title: "AIによる総合評価（★5段階）", get: (r) => sum(r)?.stars },
    { id: "action", label: "AI判断", title: "AIによる今後1〜3か月の判断", get: (r) => (sum(r) ? ACTION_SCORE[sum(r).action] : undefined) },
    { id: "upside", label: "目標まで", title: "AIの目標株価までの上昇余地", get: (r) => sum(r)?.upside, cls: "hide-sm" },
    ...PERIODS.map((p) => ({ id: `r:${p}`, label: p, get: (r: StockRow) => r.stock.returns?.[p] })),
    { id: "cap", label: "時価総額", get: (r) => r.stock.marketCap, cls: "hide-sm" },
    { id: "high52", label: "高値から", title: "52週高値からの下落率", get: (r) => r.stock.high52, cls: "hide-sm" },
    { id: "ma50", label: "50日線", title: "50日移動平均からの乖離", get: (r) => r.stock.ma50, cls: "hide-sm" },
    { id: "ma200", label: "200日線", title: "200日移動平均からの乖離", get: (r) => r.stock.ma200, cls: "hide-sm" },
    { id: "vol", label: "出来高", title: "直近20日平均に対する今日の出来高（倍）", get: (r) => r.stock.volRatio, cls: "hide-sm" },
    { id: "beta", label: "β", title: "指数（S&P500 / TOPIX）が1%動いたときに何%動くか（1年）", get: (r) => r.stock.beta, cls: "hide-sm" },
  ];

  const sorted = useMemo(() => {
    const col = cols.find((c) => c.id === sort.id) ?? cols[0];
    const val = (r: StockRow) => {
      const v = col.get(r);
      return typeof v === "number" ? v : sort.asc ? Infinity : -Infinity;
    };
    return [...rows].filter((r) => !r.stock.missing).sort((a, b) => (sort.asc ? val(a) - val(b) : val(b) - val(a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, ai]);

  const head = (c: Col) => (
    <th key={c.id} className={`num sortable ${c.cls ?? ""}${sort.id === c.id ? " sorted" : ""}`} title={c.title ?? "クリックで並べ替え"}
      onClick={() => setSort((s) => ({ id: c.id, asc: s.id === c.id ? !s.asc : false }))}>
      {c.label}{sort.id === c.id ? (sort.asc ? " ▲" : " ▼") : ""}
    </th>
  );

  if (!sorted.length) return <div className="panel empty">該当する銘柄がありません</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th></th>
            <th>銘柄</th>
            <th className="num hide-sm">株価</th>
            <th className="hide-sm">60日</th>
            {cols.map(head)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const s = r.stock;
            const key = `${r.market}:${r.ticker}`;
            return (
              <tr key={key}>
                <td><Star on={fav.stocks.includes(key)} onClick={() => toggle("stocks", key)} label={s.name} /></td>
                <td className="name-cell">
                  <Link href={stockHref(r.market, r.ticker)}>
                    <span className="ticker">{r.market === "jp" ? s.name : r.ticker}</span>{" "}
                    <span className="muted small">{r.market === "jp" ? r.ticker.replace(".T", "") : s.name}</span>
                  </Link>
                  {(showThemes || showMarket) && (
                    <span className="path">
                      {[
                        showMarket && (r.market === "jp" ? "日本株" : "米国株"),
                        showThemes && s.sector,
                        showThemes && r.themes?.join(" / "),
                      ].filter(Boolean).join("・")}
                    </span>
                  )}
                </td>
                <td className="num hide-sm">{fmtNum(s.close, r.currency === "JPY" ? 0 : 2)}</td>
                <td className="hide-sm">{s.spark && <Sparkline values={s.spark} width={70} height={22} />}</td>
                <td className="num stars-cell">{sum(r) ? "★".repeat(sum(r).stars) : <span className="muted">—</span>}</td>
                <td>{sum(r) ? <span className={`badge ${actionClass(sum(r).action)}`}>{sum(r).action}</span> : <span className="muted">—</span>}</td>
                <td className="num hide-sm"><Pct v={sum(r)?.upside} /></td>
                {PERIODS.map((p) => <HeatCell key={p} v={s.returns?.[p]} period={p} strong={sort.id === `r:${p}`} />)}
                <td className="num hide-sm">
                  {fmtCap(s.marketCap, r.currency)}
                  {s.capClass && <div className="small muted">{s.capClass}</div>}
                </td>
                <td className="num hide-sm"><Pct v={s.high52} /></td>
                <td className="num hide-sm"><Pct v={s.ma50} /></td>
                <td className="num hide-sm"><Pct v={s.ma200} /></td>
                <td className={`num hide-sm${(s.volRatio ?? 0) >= 2 ? " strongvol" : ""}`}>{s.volRatio ? `${s.volRatio.toFixed(1)}x` : "—"}</td>
                <td className="num hide-sm">{fmtNum(s.beta)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
