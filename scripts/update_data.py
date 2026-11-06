"""株価を取得して、テーマ別の騰落率をJSONに書き出す。

使い方:
  python scripts/update_data.py              # 米国株・日本株の両方を実データで更新
  python scripts/update_data.py --market jp  # 日本株だけ
  python scripts/update_data.py --sample     # ネットに繋がずサンプルデータを作る（開発用）

出力先: web/public/data/{us,jp}.json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
OUT_DIR = ROOT / "web" / "public" / "data"

# 期間名 → 何営業日前と比べるか
PERIODS = {"1D": 1, "5D": 5, "10D": 10, "1M": 21, "2M": 42, "3M": 63, "6M": 126, "1Y": 252}
LEVELS = ["sector", "subsector", "bigTheme", "theme"]
SERIES_DAYS = 252  # テーマ詳細のチャートに使う日数
RANK_HISTORY_DAYS = 20  # 「過去順位」に使う日数
SPARK_DAYS = 60  # 銘柄ごとのミニチャートの日数

# 時価総額の区分（米ドル）。日本株は円をドルに換算して判定する。
CAP_CLASSES = [(200e9, "Mega"), (10e9, "Large"), (2e9, "Mid"), (250e6, "Small"), (0, "Micro")]
JPY_PER_USD = 150.0


# ---------------------------------------------------------------- 設定の読み込み

def slug(*parts: str) -> str:
    """階層の名前から安定したIDを作る（日本語はそのまま残す）。"""
    s = "--".join(parts)
    return re.sub(r"[\s/・]+", "-", s)


def load_config(market: str) -> dict:
    with open(CONFIG_DIR / f"{market}.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def norm_ticker(raw, market: str) -> str:
    """設定に書いたティッカーをYahooの表記にそろえる（日本株は 8035 → 8035.T）。"""
    t = str(raw).strip().upper().replace(".", "-") if market == "us" else str(raw).strip().upper()
    if market == "jp" and re.fullmatch(r"[0-9A-Z]{4}", t):
        t += ".T"
    return t


def parse_tickers(spec, market: str) -> tuple[list[str], dict[str, str]]:
    """tickers の書き方（リスト／辞書／リストの中に {ティッカー: 名前}）を読み取る。"""
    tickers: list[str] = []
    names: dict[str, str] = {}
    items = spec.items() if isinstance(spec, dict) else [
        next(iter(x.items())) if isinstance(x, dict) else (x, None) for x in spec
    ]
    for raw, name in items:
        t = norm_ticker(raw, market)
        tickers.append(t)
        if name:
            names[t] = str(name)
    return unique(tickers), names


def load_universe(market: str) -> dict[str, dict]:
    """指数の構成銘柄一覧（config/universe/{market}.csv）。"""
    path = CONFIG_DIR / "universe" / f"{market}.csv"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return {r["ticker"]: r for r in csv.DictReader(f)}


def build_groups(cfg: dict) -> tuple[list[dict], dict[str, str]]:
    """設定を、階層ごとのグループ一覧と「ティッカー → 表示名」に展開する。"""
    market = cfg["market"]
    groups: list[dict] = []
    names: dict[str, str] = {}

    def add(level, name, path, parent, tickers):
        groups.append({
            "id": slug(*path),
            "level": level,
            "name": name,
            "path": path,
            "parent": slug(*path[:-1]) if parent else None,
            "tickers": tickers,
        })

    for sec in cfg["sectors"]:
        sec_t: list[str] = []
        for sub in sec["subsectors"]:
            sub_t: list[str] = []
            for big in sub["bigThemes"]:
                big_t: list[str] = []
                for th in big["themes"]:
                    t, n = parse_tickers(th["tickers"], market)
                    names.update(n)
                    path = [sec["name"], sub["name"], big["name"], th["name"]]
                    add("theme", th["name"], path, True, t)
                    big_t += t
                add("bigTheme", big["name"], [sec["name"], sub["name"], big["name"]], True, unique(big_t))
                sub_t += big_t
            add("subsector", sub["name"], [sec["name"], sub["name"]], True, unique(sub_t))
            sec_t += sub_t
        add("sector", sec["name"], [sec["name"]], False, unique(sec_t))
    return groups, names


def unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


# ---------------------------------------------------------------- 株価の取得

def fetch_prices(tickers: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    import yfinance as yf

    def download(batch):
        df = yf.download(batch, period="2y", interval="1d", auto_adjust=True,
                         progress=False, group_by="column", threads=True)
        return df["Close"].reindex(columns=batch), df["Volume"].reindex(columns=batch)

    closes, volumes = [], []
    for i in range(0, len(tickers), 100):  # 一度に頼みすぎると取りこぼすので100銘柄ずつ
        c, v = download(tickers[i:i + 100])
        closes.append(c)
        volumes.append(v)
    close = pd.concat(closes, axis=1)
    volume = pd.concat(volumes, axis=1)

    retry = [t for t in tickers if close[t].dropna().empty]
    if retry:  # 取りこぼした銘柄だけもう一度
        c, v = download(retry)
        for t in retry:
            if not c[t].dropna().empty:
                close[t], volume[t] = c[t], v[t]
    close = close.reindex(columns=tickers)
    volume = volume.reindex(columns=tickers)
    missing = [t for t in tickers if close[t].dropna().empty]
    if missing:
        print(f"  ! 株価が取れなかった銘柄: {', '.join(missing)}", file=sys.stderr)
    return close, volume


def fetch_market_caps(tickers: list[str]) -> dict[str, float]:
    import yfinance as yf

    def one(t):
        try:
            cap = yf.Ticker(t).fast_info.get("marketCap")
            if cap and not math.isnan(cap):
                return t, float(cap)
        except Exception:  # 時価総額が取れなくても他の計算は続ける
            pass
        return t, None

    with ThreadPoolExecutor(max_workers=8) as ex:
        caps = {t: c for t, c in ex.map(one, tickers) if c}
    if len(caps) < len(tickers):
        print(f"  ! 時価総額が取れなかった銘柄: {len(tickers) - len(caps)}", file=sys.stderr)
    return caps


def repair_splits(close: pd.DataFrame, volume: pd.DataFrame) -> pd.DataFrame:
    """Yahooのデータで株式分割が反映されていない箇所を直す。

    1日で株価が2倍以上（または半分以下）になり、その倍率が分割比率らしい
    きりのいい数（2, 3, 4, 5, 10 など）に近いとき、それより前の株価を割り戻す。
    ただし出来高が普段の3倍以上の日は、本当に急騰・急落したとみなして直さない。
    """
    ratios = [2, 3, 4, 5, 8, 10, 20, 25, 50, 100]
    fixed = close.copy()
    for col in fixed.columns:
        s = fixed[col].dropna()
        if len(s) < 2:
            continue
        jump = (s / s.shift(1)).iloc[1:]
        vol = volume[col].reindex(s.index)
        usual = vol.shift(1).rolling(20, min_periods=5).median()
        for day, r in jump.items():
            if vol.get(day, 0) > 3 * (usual.get(day) or float("inf")):
                continue
            for n in ratios:
                for target in (n, 1 / n):
                    # 2倍は普通の急騰でも起きるので判定を厳しくする
                    tol = 0.03 if n == 2 else 0.05
                    if abs(r / target - 1) < tol:
                        fixed.loc[fixed.index < day, col] *= target
                        print(f"  ~ {col}: {day.date()} の分割（約{r:.2f}倍）を補正", file=sys.stderr)
                        break
                else:
                    continue
                break
    return fixed


def sample_prices(tickers: list[str], groups: list[dict], seed: int) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """テーマごとに値動きが似るようなランダムな株価を作る（開発用）。"""
    rng = np.random.default_rng(seed)
    days = 520
    idx = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=days)
    market = rng.normal(0.0004, 0.010, days)
    theme_of = {}
    for g in groups:
        if g["level"] == "theme":
            for t in g["tickers"]:
                theme_of.setdefault(t, g["id"])
    factors = {tid: rng.normal(rng.normal(0.0003, 0.0008), 0.012, days) for tid in set(theme_of.values())}
    close, vol, caps = {}, {}, {}
    for t in tickers:
        beta = rng.uniform(0.6, 1.8)
        r = beta * market + factors.get(theme_of.get(t), 0) + rng.normal(0, 0.015, days)
        close[t] = rng.uniform(20, 500) * np.exp(np.cumsum(r))
        vol[t] = rng.lognormal(15, 0.4, days)
        caps[t] = float(10 ** rng.uniform(8.5, 12.5))
    return pd.DataFrame(close, index=idx), pd.DataFrame(vol, index=idx), caps


# ---------------------------------------------------------------- 計算

def pct(a: float, b: float) -> float | None:
    if a is None or b is None or not np.isfinite(a) or not np.isfinite(b) or b == 0:
        return None
    return round((a / b - 1) * 100, 2)


def period_returns(s: pd.Series) -> dict[str, float | None]:
    s = s.dropna()
    out = {}
    for p, n in PERIODS.items():
        out[p] = pct(s.iloc[-1], s.iloc[-1 - n]) if len(s) > n else None
    return out


def cap_class(cap_usd: float | None) -> str | None:
    if cap_usd is None:
        return None
    for limit, name in CAP_CLASSES:
        if cap_usd >= limit:
            return name
    return "Micro"


def rnd(x, d=2):
    return None if x is None or not np.isfinite(x) else round(float(x), d)


def stock_stats(t: str, name: str, meta: dict, c: pd.Series, v: pd.Series, bench: pd.Series,
                cap: float | None, currency: str) -> dict:
    c = c.dropna()
    info = {"name": name, "sector": meta.get("sector") or None, "industry": meta.get("industry") or None,
            "inIndex": bool(meta)}
    if c.empty:
        return {**info, "missing": True}
    last = c.iloc[-1]
    yr = c.iloc[-252:]
    daily = c.pct_change()
    b = bench.reindex(c.index).pct_change()
    pair = pd.concat([daily, b], axis=1).dropna().iloc[-252:]
    beta = None
    if len(pair) > 30 and pair.iloc[:, 1].var() > 0:
        beta = pair.cov().iloc[0, 1] / pair.iloc[:, 1].var()
    ma50 = c.iloc[-50:].mean() if len(c) >= 50 else None
    ma200 = c.iloc[-200:].mean() if len(c) >= 200 else None
    vv = v.reindex(c.index).dropna()
    vol_ratio = vv.iloc[-1] / vv.iloc[-21:-1].mean() if len(vv) > 21 and vv.iloc[-21:-1].mean() > 0 else None
    cap_usd = cap / JPY_PER_USD if cap and currency == "JPY" else cap
    spark = c.iloc[-SPARK_DAYS:]
    return {
        **info,
        "close": rnd(last, 2),
        "returns": period_returns(c),
        "marketCap": cap,
        "capClass": cap_class(cap_usd),
        "high52": pct(last, yr.max()),
        "low52": pct(last, yr.min()),
        "ma50": pct(last, ma50) if ma50 else None,
        "ma200": pct(last, ma200) if ma200 else None,
        "volRatio": rnd(vol_ratio, 2),
        "beta": rnd(beta, 2),
        "spark": [rnd(x / spark.iloc[0] * 100, 1) for x in spark],
    }


def group_index(close: pd.DataFrame, tickers: list[str]) -> pd.Series:
    """構成銘柄の日次騰落率の単純平均を積み上げた指数（100始まり）。"""
    cols = [t for t in tickers if t in close and not close[t].dropna().empty]
    if not cols:
        return pd.Series(dtype=float)
    daily = close[cols].pct_change(fill_method=None).mean(axis=1, skipna=True).fillna(0)
    return 100 * (1 + daily).cumprod()


def compute(cfg: dict, close: pd.DataFrame, volume: pd.DataFrame, caps: dict) -> dict:
    groups, names, universe = all_names(cfg)
    bench_syms = list(cfg["benchmarks"].keys())
    main_bench = close[bench_syms[0]]
    currency = cfg.get("currency", "USD")

    stocks = {t: stock_stats(t, n, universe.get(t, {}), close[t], volume[t], main_bench, caps.get(t), currency)
              for t, n in names.items()}

    # 各グループの指数・騰落率・上昇銘柄の割合
    indexes = {}
    for g in groups:
        idx = group_index(close, g["tickers"])
        indexes[g["id"]] = idx
        g["returns"] = period_returns(idx) if not idx.empty else {p: None for p in PERIODS}
        ups = [stocks[t]["returns"]["1D"] for t in g["tickers"] if not stocks[t].get("missing")]
        ups = [x for x in ups if x is not None]
        g["breadth"] = round(100 * sum(x > 0 for x in ups) / len(ups)) if ups else None
        g["marketCap"] = sum(stocks[t].get("marketCap") or 0 for t in g["tickers"]) or None
        tail = idx.iloc[-SERIES_DAYS:]
        g["series"] = [rnd(x / tail.iloc[0] * 100, 2) for x in tail] if len(tail) else []

    # 過去順位: 各日の1M騰落率でテーマを順位付けした履歴（古い順）
    for level in LEVELS:
        ids = [g["id"] for g in groups if g["level"] == level]
        mat = pd.DataFrame({i: indexes[i] for i in ids})
        r1m = (mat / mat.shift(PERIODS["1M"]) - 1).iloc[-RANK_HISTORY_DAYS:]
        ranks = r1m.rank(axis=1, ascending=False, method="min")
        for g in groups:
            if g["level"] == level:
                g["rankHistory"] = [None if pd.isna(x) else int(x) for x in ranks[g["id"]]]

    dates = close.index[-SERIES_DAYS:]
    benchmarks = []
    for sym, label in cfg["benchmarks"].items():
        s = close[sym].dropna()
        tail = s.reindex(dates).ffill()
        benchmarks.append({
            "symbol": sym,
            "name": label,
            "returns": period_returns(s),
            "series": [rnd(x / tail.dropna().iloc[0] * 100, 2) for x in tail] if tail.notna().any() else [],
        })

    return {
        "market": cfg["market"],
        "name": cfg["name"],
        "currency": currency,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asOf": str(close.dropna(how="all").index[-1].date()),
        "periods": list(PERIODS.keys()),
        "dates": [str(d.date()) for d in dates],
        "benchmarks": benchmarks,
        "groups": groups,
        "stocks": stocks,
    }


def all_names(cfg: dict) -> tuple[list[dict], dict[str, str], dict[str, dict]]:
    """指数の全銘柄＋テーマに書いた銘柄の「ティッカー → 表示名」。

    名前の優先順位: 設定の names ＞ テーマに書いた名前 ＞ 指数一覧の名前
    """
    market = cfg["market"]
    groups, theme_names = build_groups(cfg)
    universe = load_universe(market)
    names = {t: r["name"] for t, r in universe.items()}
    for g in groups:
        for t in g["tickers"]:
            names.setdefault(t, t)
    names.update(theme_names)
    for raw, n in (cfg.get("names") or {}).items():
        names[norm_ticker(raw, market)] = str(n)
    names = {t: n for t, n in names.items() if t in universe or any(t in g["tickers"] for g in groups)}
    return groups, names, universe


# ---------------------------------------------------------------- 実行

def run(market: str, sample: bool) -> None:
    cfg = load_config(market)
    groups, names, universe = all_names(cfg)
    tickers = unique(list(names.keys()) + list(cfg["benchmarks"].keys()))
    themed = {t for g in groups for t in g["tickers"]}
    print(f"[{market}] {len(names)} 銘柄（指数 {len(universe)}・テーマに所属 {len(themed)}）"
          f" / {sum(g['level'] == 'theme' for g in groups)} テーマ")

    if sample:
        close, volume, caps = sample_prices(tickers, groups, seed=1 if market == "us" else 2)
    else:
        close, volume = fetch_prices(tickers)
        close = repair_splits(close, volume)
        caps = fetch_market_caps(list(names.keys()))
    # 市場が違う銘柄の休場日で行がずれないよう、全銘柄が休みの日だけ消す
    close = close.dropna(how="all")
    volume = volume.reindex(close.index)

    data = compute(cfg, close, volume, caps)
    if sample:
        data["sample"] = True
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{market}.json"
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[{market}] 書き出し: {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB, 基準日 {data['asOf']})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--market", choices=["us", "jp", "all"], default="all")
    ap.add_argument("--sample", action="store_true", help="サンプルデータを作る（ネット不要）")
    args = ap.parse_args()
    for m in (["us", "jp"] if args.market == "all" else [args.market]):
        run(m, args.sample)


if __name__ == "__main__":
    main()
