"""S&P500 と 日経225 の構成銘柄一覧を Wikipedia から取得して CSV に保存する。

使い方:
  python scripts/update_universe.py

出力先: config/universe/us.csv, config/universe/jp.csv
（列: ticker,name,sector,industry）

指数の入れ替えは年に数回なので、月1回の自動実行（GitHub Actions）で十分。
取得結果の件数がおかしいときは、ファイルを上書きせずにエラーで止まる。
"""

from __future__ import annotations

import csv
import io
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "config" / "universe"
UA = {"User-Agent": "theme-tracker/1.0 (index constituents fetch)"}

SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
N225_URL = "https://ja.wikipedia.org/wiki/%E6%97%A5%E7%B5%8C%E5%B9%B3%E5%9D%87%E6%A0%AA%E4%BE%A1"

# GICSセクターの日本語名
GICS_JA = {
    "Communication Services": "通信サービス",
    "Consumer Discretionary": "一般消費財",
    "Consumer Staples": "生活必需品",
    "Energy": "エネルギー",
    "Financials": "金融",
    "Health Care": "ヘルスケア",
    "Industrials": "資本財",
    "Information Technology": "情報技術",
    "Materials": "素材",
    "Real Estate": "不動産",
    "Utilities": "公益",
}

# 日本株の社名を表に収まるよう短くする（テーマ定義で名前を書けばそちらが優先）
JP_SHORTEN = [
    ("フィナンシャル・グループ", "FG"),
    ("フィナンシャルグループ", "FG"),
    ("インシュアランスグループホールディングス", ""),
    ("グループホールディングス", "HD"),
    ("ホールディングス", "HD"),
    ("グループ本社", ""),
    ("・グループ", "G"),
]


def get(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def fetch_sp500() -> list[dict]:
    import pandas as pd

    table = pd.read_html(io.StringIO(get(SP500_URL)))[0]
    rows = []
    for r in table.itertuples(index=False):
        sym = str(r[0]).strip().replace(".", "-")  # BRK.B → BRK-B（Yahooの表記）
        rows.append({
            "ticker": sym,
            "name": str(r[1]).strip(),
            "sector": GICS_JA.get(str(r[2]).strip(), str(r[2]).strip()),
            "industry": str(r[3]).strip(),
        })
    if not 480 <= len(rows) <= 520:
        raise SystemExit(f"S&P500 の件数がおかしいので中止します: {len(rows)}")
    return rows


def fetch_n225() -> list[dict]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(get(N225_URL), "lxml")
    rows = []
    for t in soup.find_all("table"):
        head = [th.get_text(strip=True) for th in t.find_all("th")][:2]
        if head != ["証券コード", "銘柄"]:
            continue
        h = t.find_previous(["h3", "h4", "h5"])
        sector = re.sub(r"（.*", "", h.get_text(strip=True)) if h else ""
        for tr in t.find_all("tr")[1:]:
            td = [x.get_text(strip=True) for x in tr.find_all(["td", "th"])]
            if len(td) < 2 or not re.fullmatch(r"[0-9A-Z]{4}", td[0]):
                continue
            name = td[1]
            for a, b in JP_SHORTEN:
                name = name.replace(a, b)
            rows.append({"ticker": f"{td[0]}.T", "name": name, "sector": sector, "industry": sector})
    if len(rows) != 225:
        raise SystemExit(f"日経225 の件数が225ではないので中止します: {len(rows)}")
    return rows


def save(market: str, rows: list[dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{market}.csv"
    rows = sorted(rows, key=lambda r: r["ticker"])
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["ticker", "name", "sector", "industry"])
        w.writeheader()
        w.writerows(rows)
    print(f"[{market}] {len(rows)} 銘柄 → {path.relative_to(ROOT)}")


def main() -> None:
    try:
        save("us", fetch_sp500())
        save("jp", fetch_n225())
    except SystemExit:
        raise
    except Exception as e:  # ネットワークや表の形式が変わったとき
        print(f"構成銘柄の取得に失敗しました: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
