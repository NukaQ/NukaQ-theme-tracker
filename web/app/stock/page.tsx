"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import AnalyzeButton from "@/components/AnalyzeButton";
import { Chips, Loading, Pct, Star } from "@/components/ui";
import { fileName, useJson, useMarketData } from "@/lib/data";
import { useFavorites } from "@/lib/favorites";
import { actionClass, fmtCap, fmtNum, fmtPct, signClass } from "@/lib/format";
import { quoteUrl } from "@/lib/links";
import { useViewParams, withView } from "@/lib/params";
import type { Action, Analysis, MarketData, StockDetail, Technicals } from "@/lib/types";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <StockPage />
    </Suspense>
  );
}

function StockPage() {
  const { market, sp } = useViewParams();
  const ticker = sp.get("t") ?? "";
  const { data: md, error } = useMarketData(market);
  const detail = useJson<StockDetail>(ticker ? `/stock/${market}/${fileName(ticker)}.json` : null);
  // 解析が終わったら version を上げて、最新のファイルを読み直す
  const [version, setVersion] = useState(0);
  const analysis = useJson<Analysis>(ticker ? `/analysis/${market}/${fileName(ticker)}.json${version ? `?v=${version}` : ""}` : null);
  const reload = useCallback(() => setVersion(Date.now()), []);
  const { fav, toggle } = useFavorites();

  if (!md) return <Loading error={error} />;
  const s = md.stocks[ticker];
  if (!s) {
    return (
      <div className="empty">
        銘柄が見つかりません。<Link href={withView("/stocks/", market)} style={{ color: "var(--accent)" }}>銘柄一覧に戻る</Link>
      </div>
    );
  }
  const themes = md.groups.filter((g) => g.level === "theme" && g.tickers.includes(ticker));
  const favKey = `${market}:${ticker}`;
  const a = analysis.data;
  const cur = md.currency;
  const code = market === "jp" ? ticker.replace(".T", "") : ticker;

  return (
    <>
      <div className="crumbs">
        <Link href={withView("/stocks/", market)}>{md.name}</Link> › {s.sector ?? "銘柄"}
      </div>
      <div className="detail-head">
        <h1>{s.name}</h1>
        <span className="muted">{code}</span>
        <Star on={fav.stocks.includes(favKey)} onClick={() => toggle("stocks", favKey)} label={s.name} />
        <a className="badge" href={quoteUrl(market, ticker)} target="_blank" rel="noreferrer">Yahoo!ファイナンス ↗</a>
      </div>
      <div className="price-line">
        <span className="price">{fmtPrice(s.close, cur)}</span>
        <Pct v={s.returns?.["1D"]} digits={2} />
        <span className="muted small">基準日 {md.asOf}・時価総額 {fmtCap(s.marketCap, cur)}{s.capClass ? `（${s.capClass}）` : ""}</span>
      </div>
      {themes.length > 0 && (
        <div className="tags">
          {themes.map((g) => (
            <Link key={g.id} className="tag" href={withView("/theme/", market, { id: g.id })}>{g.name}</Link>
          ))}
        </div>
      )}

      <AnalyzeButton market={market} ticker={ticker} hasAnalysis={!!a} onDone={reload} />
      {a ? <AiSummary a={a} md={md} close={s.close ?? null} /> : analysis.done && <NoAnalysis />}

      <section className="panel section">
        <h2>チャート</h2>
        {detail.data ? <PriceChart d={detail.data} a={a} currency={cur} /> : <Loading error={detail.error} />}
      </section>

      <div className="grid2">
        <section className="panel section">
          <h2>テクニカル解析 {a && <span className={`badge ${trendClass(a.ai.technical.trend)}`}>{a.ai.technical.trend}</span>}</h2>
          {a && <AiText summary={a.ai.technical.summary} bullets={a.ai.technical.signals} />}
          {a && (
            <p className="small muted">
              下値の目安 <b>{fmtPrice(a.ai.technical.support, cur)}</b>・上値の目安 <b>{fmtPrice(a.ai.technical.resistance, cur)}</b>
            </p>
          )}
          {detail.data && <TechTable t={detail.data.technicals} cur={cur} />}
        </section>

        <section className="panel section">
          <h2>ファンダメンタルズ解析 {a && <span className={`badge ${valuationClass(a.ai.fundamental.valuation)}`}>{a.ai.fundamental.valuation}</span>}</h2>
          {a ? (
            <>
              <AiText summary={a.ai.fundamental.summary} />
              <div className="proscons">
                <div><h3 className="up">強み</h3><ul>{a.ai.fundamental.strengths.map((x) => <li key={x}>{x}</li>)}</ul></div>
                <div><h3 className="down">リスク</h3><ul>{a.ai.fundamental.risks.map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
              <FundTable f={a.facts.fundamentals} cur={cur} />
            </>
          ) : <p className="muted small">AI解析が済むと、財務指標と解析が表示されます。</p>}
        </section>

        <section className="panel section">
          <h2>決算 {a && <span className={`badge ${resultClass(a.ai.earnings.lastResult)}`}>直近: {a.ai.earnings.lastResult}</span>}</h2>
          {a ? <Earnings a={a} cur={cur} /> : <p className="muted small">AI解析が済むと、決算の解析と次回の決算日が表示されます。</p>}
        </section>

        <section className="panel section">
          <h2>ニュース</h2>
          {a ? <News a={a} /> : <p className="muted small">AI解析が済むと、直近のニュースが表示されます。</p>}
        </section>
      </div>

      <p className="muted small disclaimer">
        AI解析は Claude（Anthropic）が公開データをもとに自動で作成した参考情報で、内容の正確性は保証されません。
        特定銘柄の売買を推奨するものではなく、投資の最終判断はご自身でお願いします。
      </p>
    </>
  );
}

// ---------------------------------------------------------------- AIの要約

const ACTIONS: Action[] = ["売り", "やや売り", "中立", "やや買い", "買い"];

function AiSummary({ a, md, close }: { a: Analysis; md: MarketData; close: number | null }) {
  const cur = md.currency;
  const tp = a.ai.targetPrice;
  const upside = close && tp.price ? (tp.price / close - 1) * 100 : tp.upsidePct;
  const an = a.facts.analyst;
  return (
    <section className="panel ai-card">
      <div className="ai-label">AI解析 <span className="muted small">{a.analyzedAt.slice(0, 10)} 時点</span></div>
      <p className="headline">{a.ai.headline}</p>
      <div className="ai-grid">
        <div>
          <div className="k">総合評価</div>
          <Stars n={a.ai.rating.stars} />
          <p className="small">{a.ai.rating.reason}</p>
        </div>
        <div>
          <div className="k">直近の判断（1〜3か月）</div>
          <div className="verdict-scale">
            {ACTIONS.map((x) => (
              <span key={x} className={x === a.ai.verdict.action ? `on ${actionClass(x)}` : ""}>{x}</span>
            ))}
          </div>
          <p className="small">{a.ai.verdict.reason}</p>
        </div>
        <div>
          <div className="k">目標株価（6〜12か月）</div>
          <div className="big">{fmtPrice(tp.price, cur)} <span className={`small ${signClass(upside)}`}>{fmtPct(upside)}</span></div>
          <p className="small">{tp.basis}</p>
          {an.targetMeanPrice != null && (
            <p className="small muted">
              アナリスト予想の平均 {fmtPrice(Number(an.targetMeanPrice), cur)}
              {an.numberOfAnalystOpinions ? `（${an.numberOfAnalystOpinions}人）` : ""}
              {an.recommendationKey ? `・${RECO[String(an.recommendationKey)] ?? an.recommendationKey}` : ""}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const RECO: Record<string, string> = {
  strong_buy: "強い買い", buy: "買い", hold: "中立", underperform: "やや売り", sell: "売り", none: "—",
};

function NoAnalysis() {
  return (
    <section className="panel ai-card muted">
      この銘柄のAI解析はまだありません。AI解析は管理者が依頼した銘柄だけ行っています。
    </section>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <div className="stars" aria-label={`5段階中${n}`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= n ? "on" : ""}>★</span>)}
    </div>
  );
}

function AiText({ summary, bullets }: { summary: string; bullets?: string[] }) {
  return (
    <>
      <p>{summary}</p>
      {bullets && bullets.length > 0 && <ul>{bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
    </>
  );
}

// ---------------------------------------------------------------- 表

function TechTable({ t, cur }: { t: Technicals; cur: string }) {
  if (!t || !t.maWindows) return null;
  const rows: [string, React.ReactNode][] = [
    ...t.maWindows.map((n) => [`${n}日線からの乖離`, <Pct key={n} v={t.maDev[String(n)]} />] as [string, React.ReactNode]),
    ["移動平均の並び", t.maOrder ?? "—"],
    ...(t.maCross ? [["移動平均のクロス", t.maCross] as [string, React.ReactNode]] : []),
    ["RSI（14日）", <span key="rsi" className={t.rsi14 != null && t.rsi14 >= 70 ? "down" : t.rsi14 != null && t.rsi14 <= 30 ? "up" : ""}>{fmtNum(t.rsi14, 1)}{t.rsi14 != null && (t.rsi14 >= 70 ? "（買われすぎ）" : t.rsi14 <= 30 ? "（売られすぎ）" : "")}</span>],
    ["MACD", `${fmtNum(t.macd, 2)} / シグナル ${fmtNum(t.macdSignal, 2)}${t.macdCross ? `（${t.macdCross}）` : ""}`],
    ["ボリンジャーバンド", t.bbPos == null ? "—" : `${t.bbPos <= 0 ? "-2σ以下" : t.bbPos >= 100 ? "+2σ以上" : `-2σ〜+2σの ${t.bbPos}% の位置`}`],
    ["52週高値・安値", `${fmtPrice(t.high52, cur)} / ${fmtPrice(t.low52, cur)}（高値から ${fmtPct(t.fromHigh52)}）`],
    ["出来高（20日平均比）", t.volRatio ? `${t.volRatio.toFixed(2)}倍` : "—"],
    ["変動率（年率）", t.volatility != null ? `${t.volatility}%` : "—"],
  ];
  return <KV rows={rows} />;
}

const FUND_ROWS: [string, string, (v: number, cur: string) => string][] = [
  ["trailingPE", "PER（実績）", (v) => `${v.toFixed(1)}倍`],
  ["forwardPE", "PER（予想）", (v) => `${v.toFixed(1)}倍`],
  ["priceToBook", "PBR", (v) => `${v.toFixed(2)}倍`],
  ["priceToSalesTrailing12Months", "PSR", (v) => `${v.toFixed(2)}倍`],
  ["enterpriseToEbitda", "EV/EBITDA", (v) => `${v.toFixed(1)}倍`],
  ["returnOnEquity", "ROE", (v) => `${v.toFixed(1)}%`],
  ["operatingMargins", "営業利益率", (v) => `${v.toFixed(1)}%`],
  ["profitMargins", "純利益率", (v) => `${v.toFixed(1)}%`],
  ["revenueGrowth", "売上成長率（前年比）", (v) => fmtPct(v)],
  ["earningsGrowth", "利益成長率（前年比）", (v) => fmtPct(v)],
  ["dividendYield", "配当利回り", (v) => `${v.toFixed(2)}%`],
  ["payoutRatio", "配当性向", (v) => `${v.toFixed(0)}%`],
  ["debtToEquity", "負債資本倍率", (v) => `${(v / 100).toFixed(2)}倍`],
  ["freeCashflow", "フリーキャッシュフロー", (v, cur) => fmtCap(v, cur)],
];

function FundTable({ f, cur }: { f: Record<string, number>; cur: string }) {
  const rows = FUND_ROWS.filter(([k]) => typeof f[k] === "number").map(([k, label, fmt]) => [label, fmt(f[k], cur)] as [string, React.ReactNode]);
  return rows.length ? <KV rows={rows} /> : null;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="kv">
      <tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody>
    </table>
  );
}

function Earnings({ a, cur }: { a: Analysis; cur: string }) {
  const e = a.facts.earnings;
  const next = e.next?.date;
  const days = next ? Math.round((new Date(next).getTime() - Date.now()) / 86400000) : null;
  return (
    <>
      <div className="next-earnings">
        <div className="k">次回の決算発表</div>
        <div className="big">{next ? next.replaceAll("-", "/") : "未定"}</div>
        {days != null && days >= 0 && <span className="badge">あと{days}日</span>}
        {e.next?.epsEstimate != null && <span className="small muted">EPS予想 {fmtNum(e.next.epsEstimate, 2)}</span>}
      </div>
      <AiText summary={a.ai.earnings.summary} />
      <p className="small"><b>次回の注目点:</b> {a.ai.earnings.nextFocus}</p>
      {e.history && e.history.length > 0 && (
        <table className="kv mini">
          <thead><tr><th>発表日</th><th className="num">EPS予想</th><th className="num">EPS実績</th><th className="num">差</th></tr></thead>
          <tbody>
            {[...e.history].reverse().map((h) => (
              <tr key={h.date}>
                <td>{h.date}</td>
                <td className="num">{fmtNum(h.epsEstimate, 2)}</td>
                <td className="num">{fmtNum(h.epsActual, 2)}</td>
                <td className="num"><Pct v={h.surprisePct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {e.quarterly && e.quarterly.length > 0 && (
        <table className="kv mini">
          <thead><tr><th>四半期</th><th className="num">売上高</th><th className="num">営業利益</th><th className="num">純利益</th></tr></thead>
          <tbody>
            {e.quarterly.map((q) => (
              <tr key={String(q.period)}>
                <td>{String(q.period).slice(0, 7)}</td>
                <td className="num">{fmtCap(q["Total Revenue"] as number, cur)}</td>
                <td className="num">{fmtCap(q["Operating Income"] as number, cur)}</td>
                <td className="num">{fmtCap(q["Net Income"] as number, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function News({ a }: { a: Analysis }) {
  return (
    <>
      <AiText summary={a.ai.news.summary} />
      {a.ai.news.items.length === 0 ? <p className="muted small">この銘柄に関係する直近のニュースはありませんでした。</p> : (
        <ul className="news">
          {a.ai.news.items.map((n) => (
            <li key={n.index}>
              <span className={`badge ${n.sentiment === "好材料" ? "good" : n.sentiment === "悪材料" ? "bad" : ""}`}>{n.sentiment}</span>
              <div>
                {n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.titleJa}</a> : n.titleJa}
                <div className="small muted">{n.title}・{n.publisher ?? ""} {n.date}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------- チャート

const RANGES = [
  { id: "63", label: "3か月" },
  { id: "126", label: "6か月" },
  { id: "252", label: "1年" },
] as const;
const MA_COLORS = ["#f59e0b", "#8b5cf6", "#06b6d4"];

function movingAverage(v: (number | null)[], n: number) {
  const out: (number | null)[] = [];
  let sum = 0, count = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x != null) { sum += x; count++; }
    const old = i >= n ? v[i - n] : null;
    if (i >= n && old != null) { sum -= old; count--; }
    out.push(i >= n - 1 && count === n ? sum / n : null);
  }
  return out;
}

function PriceChart({ d, a, currency }: { d: StockDetail; a: Analysis | null; currency: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("126");
  const windows = d.technicals?.maWindows ?? [];
  const view = useMemo(() => {
    const n = Number(range);
    const mas = windows.map((w) => movingAverage(d.close, w).slice(-n));
    return { dates: d.dates.slice(-n), close: d.close.slice(-n), volume: d.volume.slice(-n), mas };
  }, [d, range, windows]);

  const W = 800, H = 320, VH = 60, L = 8, R = 56, T = 10;
  const PH = H - VH - 30;
  const lines = [view.close, ...view.mas];
  const levels = a ? [a.ai.technical.support, a.ai.technical.resistance] : [];
  const vals = [...lines.flat(), ...levels].filter((x): x is number => x != null);
  let min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.05 || 1;
  min -= pad; max += pad;
  const n = view.close.length;
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * PH;
  const vmax = Math.max(1, ...view.volume.map((v) => v ?? 0));
  const path = (arr: (number | null)[]) => {
    let s = "", pen = false;
    arr.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      s += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return s;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * t);
  const dp = currency === "JPY" ? 0 : 2;
  const xt = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

  return (
    <>
      <div className="chart-head">
        <Chips label="期間" value={range} options={[...RANGES]} onChange={setRange} />
        <div className="chart-legend">
          <span><i style={{ background: "var(--accent)" }} />株価</span>
          {windows.map((w, i) => <span key={w}><i style={{ background: MA_COLORS[i] }} />{w}日線</span>)}
          {a && <span><i style={{ background: "var(--muted)" }} />AIの上値・下値の目安</span>}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="pricechart" role="img" aria-label="株価チャート">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={W - R + 4} y={y(v) + 4} fontSize="11" fill="var(--muted)">{v.toFixed(dp)}</text>
          </g>
        ))}
        {levels.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--muted)" strokeDasharray="6 4" />
            <text x={L + 4} y={y(v) - 4} fontSize="11" fill="var(--muted)">{i === 0 ? "下値の目安" : "上値の目安"} {v.toFixed(dp)}</text>
          </g>
        ))}
        {view.volume.map((v, i) => v != null && (
          <rect key={i} x={x(i) - (W - L - R) / n / 2} width={Math.max(1, (W - L - R) / n - 1)}
            y={H - 22 - (v / vmax) * VH} height={(v / vmax) * VH} fill="var(--muted)" opacity="0.35" />
        ))}
        {view.mas.map((m, i) => <path key={i} d={path(m)} fill="none" stroke={MA_COLORS[i]} strokeWidth="1.2" />)}
        <path d={path(view.close)} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {xt.map((i) => view.dates[i] && (
          <text key={i} x={x(i)} y={H - 6} fontSize="11" fill="var(--muted)"
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{view.dates[i].slice(2).replaceAll("-", "/")}</text>
        ))}
      </svg>
    </>
  );
}

// ---------------------------------------------------------------- 表示用

function fmtPrice(v: number | null | undefined, cur: string) {
  if (v == null || !Number.isFinite(v)) return "—";
  return cur === "JPY" ? `${Math.round(v).toLocaleString("ja-JP")}円` : `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

const trendClass = (t: string) => (t === "上昇トレンド" ? "good" : t === "下降トレンド" ? "bad" : "neutral");
const valuationClass = (t: string) => (t === "割安" ? "good" : t === "割高" ? "bad" : "neutral");
const resultClass = (t: string) => (t === "上振れ" ? "good" : t === "下振れ" ? "bad" : "neutral");
