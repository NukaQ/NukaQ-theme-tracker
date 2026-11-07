"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Chips, Loading, MarketBar, PeriodChips } from "@/components/ui";
import { useMarketData } from "@/lib/data";
import { fmtCap, fmtPct, heat } from "@/lib/format";
import { useViewParams, withView } from "@/lib/params";
import { stockHref } from "@/lib/links";
import { squarify } from "@/lib/treemap";
import { LEVELS, MARKETS, type Group, type MarketData, type Period } from "@/lib/types";

type SizeMode = "cap" | "equal";
const HEADER = 20;

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <MapView />
    </Suspense>
  );
}

function MapView() {
  const { market, period, level, sp, set } = useViewParams({ level: "sector" });
  const size = (sp.get("size") === "equal" ? "equal" : "cap") as SizeMode;
  const { data, error } = useMarketData(market);

  return (
    <>
      <div className="toolbar">
        <Chips label="市場" className="market" value={market} options={MARKETS} onChange={(m) => set({ m })} />
        <Chips label="階層" value={level} options={LEVELS} onChange={(lv) => set({ lv })} />
        <PeriodChips value={period} onChange={(p) => set({ p })} />
        <Chips label="大きさ" value={size} onChange={(s) => set({ size: s })}
          options={[{ id: "cap", label: "時価総額" }, { id: "equal", label: "均等" }]} />
      </div>
      {!data ? <Loading error={error} /> : (
        <>
          <MarketBar data={data} period={period} />
          <Treemap data={data} level={level} period={period} size={size} />
          <Legend period={period} />
        </>
      )}
    </>
  );
}

function Treemap({ data, level, period, size }: { data: MarketData; level: Group["level"]; period: Period; size: SizeMode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = Math.max(420, Math.round(width * (width < 640 ? 1.5 : 0.58)));

  // 時価総額はそのままだと巨大企業だけになるので平方根で大きさを決める
  const weight = (t: string) => {
    if (size === "equal") return 1;
    const cap = data.stocks[t]?.marketCap;
    return cap ? Math.sqrt(cap) : 0;
  };

  const layout = useMemo(() => {
    if (!width) return [];
    const groups = data.groups
      .filter((g) => g.level === level)
      .map((g) => ({ g, tickers: g.tickers.filter((t) => !data.stocks[t]?.missing && weight(t) > 0) }))
      .filter((x) => x.tickers.length);
    const outer = squarify(groups, (x) => x.tickers.reduce((s, t) => s + weight(t), 0), { x: 0, y: 0, w: width, h: height });
    return outer.map((o) => {
      const inner = squarify(o.item.tickers, weight, {
        x: 0, y: HEADER, w: o.w, h: Math.max(0, o.h - HEADER),
      });
      return { ...o, inner };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, level, width, height, size]);

  return (
    <div ref={ref} className="treemap" style={{ height }}>
      {layout.map(({ item: { g }, x, y, w, h, inner }) => (
        <div key={g.id} className="tm-group" style={{ left: x, top: y, width: w, height: h }}>
          <Link href={withView("/theme/", data.market, { id: g.id, p: period })} className="tm-group-label"
            title={`${g.path.join(" › ")} ${fmtPct(g.returns[period], 2)}`}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
            <span className={(g.returns[period] ?? 0) >= 0 ? "up" : "down"}>{fmtPct(g.returns[period])}</span>
          </Link>
          {inner.map((t) => {
            const s = data.stocks[t.item];
            const v = s.returns?.[period] ?? null;
            const label = data.market === "jp" ? s.name : t.item;
            // 名前がタイルの幅に収まる文字サイズにする（全角は1文字≒1em、半角は≒0.62em）
            const ems = [...label].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 1 : 0.62), 0);
            const fs = Math.max(8, Math.min(22, Math.sqrt(t.w * t.h) / 5, (t.w - 6) / Math.max(ems, 1)));
            return (
              <Link key={t.item} className="tm-tile" href={stockHref(data.market, t.item)}
                style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: heat(v, period), fontSize: fs }}
                title={`${s.name} (${t.item})\n${period}: ${fmtPct(v, 2)}\n時価総額: ${fmtCap(s.marketCap, data.currency)}`}>
                {t.w > 34 && t.h > 22 && (
                  <>
                    <span className="t" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                    {t.h > fs * 2.6 && <span className="r" style={{ fontSize: fs * 0.75 }}>{fmtPct(v)}</span>}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Legend({ period }: { period: Period }) {
  const scale: Record<Period, number> = { "1D": 3, "5D": 6, "10D": 8, "1M": 12, "2M": 16, "3M": 20, "6M": 30, "1Y": 50 };
  const m = scale[period];
  const steps = [-m, -m / 2, -m / 6, m / 6, m / 2, m];
  return (
    <div className="legend" style={{ marginTop: 8 }}>
      {steps.map((s) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span className="sw" style={{ background: heat(s, period) }} />
          {fmtPct(s, 0)}
        </span>
      ))}
      <span style={{ marginLeft: "auto" }}>タイルをクリックすると銘柄のAI解析を表示します</span>
    </div>
  );
}
