"""銘柄ごとのAI解析（テクニカル・ファンダメンタルズ・決算・ニュース・評価・目標株価・売買判断）。

【いま使っている方法】サイトの銘柄ページで管理者が「AI解析」ボタンを押すと、GitHub Actions が
  python scripts/analyze.py claude --market us NVDA
を実行し、Claude Code（Claude の有料プラン。CLAUDE_CODE_OAUTH_TOKEN）でその銘柄だけを解析する。

【API を使う方法（いまは使っていない）】以下の collect / submit は Anthropic API（従量課金）で
全銘柄を順番に解析する仕組み。ANTHROPIC_API_KEY を登録してワークフローに組み込めば使える。

株価データ（scripts/update_data.py の出力）と、Yahoo Finance から集めた財務・決算・ニュースを
Claude に渡して解析し、data/analysis/{market}/{ticker}.json に保存する。

費用を半額にするため Message Batches API を使う。バッチは結果が出るまで最大24時間かかるので、
  1. collect: 前回までに送ったバッチの結果を受け取って保存する
  2. submit : 次に解析する銘柄を選んで新しいバッチを送る
を GitHub Actions の毎回の実行で順に行う。

使い方:
  python scripts/analyze.py claude --market us NVDA       # Claude Code（有料プラン）で解析する
  python scripts/analyze.py collect
  python scripts/analyze.py submit [--limit 80]
  python scripts/analyze.py now --market us NVDA AAPL   # すぐに解析（Batchを使わない・テスト用）
  python scripts/analyze.py prompt --market jp 7203.T   # Claudeに送る内容を表示するだけ（APIを使わない）
  python scripts/analyze.py export [--from DIR]         # 解析結果をサイト（web/public/analysis）にコピー

ANTHROPIC_API_KEY が設定されていないときは何もせずに終わる（サイトのビルドは止めない）。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parent.parent
CFG = yaml.safe_load((ROOT / "config" / "analysis.yaml").read_text(encoding="utf-8"))
DATA_DIR = ROOT / "web" / "public" / "data"
STOCK_DIR = ROOT / "web" / "public" / "stock"
OUT_DIR = ROOT / "data" / "analysis"
PENDING_DIR = OUT_DIR / "pending"

# 費用の目安を表示するための単価（Batch API は通常の半額。USD / 100万トークン）
PRICES = {
    "claude-opus-5-5": (4.00, 20.00),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-haiku-5-5": (0.10, 0.50),
}

# ---------------------------------------------------------------- Claude への指示

SYSTEM = """あなたは日本の個人投資家向けに株式を分析するアナリストです。
渡されたデータ（株価・テクニカル指標・財務・アナリスト予想・決算・ニュース）だけを根拠に、銘柄の解析を日本語で書きます。

守ること:
- 数値はデータにあるものだけを使い、推測で数字を作らない。データにない項目は「データなし」と書く。
- 日付の基準は「基準日」。決算やニュースが基準日から見ていつのことかを意識する。
- ニュースは番号付きで渡す。その会社に関係のない記事（市場全体の話、別の会社が主題の記事など）は使わない。news.items には関係のある記事だけを重要な順に最大5件入れ、index には渡された番号を入れる。
- アナリスト予想（目標株価の平均など）は参考にとどめ、あなた自身のテクニカル・ファンダメンタルズの評価と合わせて判断する。
- 評価が偏らないようにする。割高・下降トレンド・悪い決算・悪材料があれば、星を下げたり「中立」「売り」寄りにしたりすることをためらわない。
- 文章は短く、具体的に。各 summary は2〜4文。専門用語には簡単な説明を添える。
- 金額はその銘柄の通貨（米国株はドル、日本株は円）で書く。

各項目の意味:
- technical: チャートの状態。trend は直近数か月の方向。support（下値の目安）と resistance（上値の目安）は株価の水準で答える。signals は注目点を3つ程度。
- fundamental: 収益性・成長性・財務の健全性・株価の割安/割高。strengths と risks はそれぞれ2〜3個。
- earnings: 直近の決算の結果（予想に対する上振れ/下振れ、売上・利益の伸び）と、次回決算で注目すべき点。
- rating.stars: 総合評価（5=非常に魅力的、4=魅力的、3=普通、2=慎重、1=避けたい）。
- targetPrice.price: 今後6〜12か月の目標株価。basis に根拠（使った倍率や比較対象）を書く。
- verdict.action: 今後1〜3か月の目線での判断。reason に理由と、判断が外れるとしたらどんな場合かを書く。
- headline: 全体を40字程度の一言で。"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["headline", "technical", "fundamental", "earnings", "news", "rating", "targetPrice", "verdict"],
    "properties": {
        "headline": {"type": "string"},
        "technical": {
            "type": "object", "additionalProperties": False,
            "required": ["summary", "trend", "signals", "support", "resistance"],
            "properties": {
                "summary": {"type": "string"},
                "trend": {"type": "string", "enum": ["上昇トレンド", "横ばい", "下降トレンド"]},
                "signals": {"type": "array", "items": {"type": "string"}},
                "support": {"type": "number"},
                "resistance": {"type": "number"},
            },
        },
        "fundamental": {
            "type": "object", "additionalProperties": False,
            "required": ["summary", "valuation", "strengths", "risks"],
            "properties": {
                "summary": {"type": "string"},
                "valuation": {"type": "string", "enum": ["割安", "適正", "割高", "判断材料不足"]},
                "strengths": {"type": "array", "items": {"type": "string"}},
                "risks": {"type": "array", "items": {"type": "string"}},
            },
        },
        "earnings": {
            "type": "object", "additionalProperties": False,
            "required": ["summary", "lastResult", "nextFocus"],
            "properties": {
                "summary": {"type": "string"},
                "lastResult": {"type": "string", "enum": ["上振れ", "おおむね予想通り", "下振れ", "データなし"]},
                "nextFocus": {"type": "string"},
            },
        },
        "news": {
            "type": "object", "additionalProperties": False,
            "required": ["summary", "items"],
            "properties": {
                "summary": {"type": "string"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object", "additionalProperties": False,
                        "required": ["index", "titleJa", "sentiment"],
                        "properties": {
                            "index": {"type": "integer"},
                            "titleJa": {"type": "string"},
                            "sentiment": {"type": "string", "enum": ["好材料", "悪材料", "中立"]},
                        },
                    },
                },
            },
        },
        "rating": {
            "type": "object", "additionalProperties": False,
            "required": ["stars", "reason"],
            "properties": {"stars": {"type": "integer", "enum": [1, 2, 3, 4, 5]}, "reason": {"type": "string"}},
        },
        "targetPrice": {
            "type": "object", "additionalProperties": False,
            "required": ["price", "basis"],
            "properties": {"price": {"type": "number"}, "basis": {"type": "string"}},
        },
        "verdict": {
            "type": "object", "additionalProperties": False,
            "required": ["action", "reason"],
            "properties": {
                "action": {"type": "string", "enum": ["買い", "やや買い", "中立", "やや売り", "売り"]},
                "reason": {"type": "string"},
            },
        },
    },
}

# ---------------------------------------------------------------- データ集め

PROFILE_KEYS = ["longName", "sector", "industry", "longBusinessSummary"]
FUND_KEYS = [
    "marketCap", "trailingPE", "forwardPE", "priceToBook", "priceToSalesTrailing12Months", "enterpriseToEbitda",
    "trailingPegRatio", "returnOnEquity", "returnOnAssets", "grossMargins", "operatingMargins", "profitMargins",
    "revenueGrowth", "earningsGrowth", "debtToEquity", "currentRatio", "totalCash", "totalDebt", "freeCashflow",
    "dividendYield", "payoutRatio", "beta", "trailingEps", "forwardEps",
]
# yfinance が小数（0.12 = 12%）で返す項目。%に直して渡す
FRACTION_KEYS = {"returnOnEquity", "returnOnAssets", "grossMargins", "operatingMargins", "profitMargins",
                 "revenueGrowth", "earningsGrowth", "payoutRatio"}
ANALYST_KEYS = ["targetMeanPrice", "targetMedianPrice", "targetHighPrice", "targetLowPrice",
                "recommendationKey", "recommendationMean", "numberOfAnalystOpinions"]
INCOME_ROWS = ["Total Revenue", "Operating Income", "Net Income", "Diluted EPS"]


def clean(x):
    """JSONに書けない値（NaN・numpyの型・日付）を直す。"""
    if isinstance(x, dict):
        return {str(k): clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, (datetime, date, pd.Timestamp)):
        return x.isoformat()[:10]
    if hasattr(x, "item"):  # numpy の数値
        x = x.item()
    if isinstance(x, float):
        return None if math.isnan(x) or math.isinf(x) else round(x, 4)
    return x


def gather(ticker: str, news_limit: int) -> dict:
    """Yahoo Finance から財務・アナリスト予想・決算・ニュースを集める。取れない項目は空のまま。"""
    import yfinance as yf

    t = yf.Ticker(ticker)
    facts: dict = {"profile": {}, "fundamentals": {}, "analyst": {}, "earnings": {}, "news": []}
    try:
        info = t.info or {}
        facts["profile"] = {k: info.get(k) for k in PROFILE_KEYS if info.get(k)}
        if "longBusinessSummary" in facts["profile"]:
            facts["profile"]["longBusinessSummary"] = facts["profile"]["longBusinessSummary"][:700]
        for k in FUND_KEYS:
            v = info.get(k)
            if isinstance(v, (int, float)) and not (isinstance(v, float) and math.isnan(v)):
                facts["fundamentals"][k] = round(v * 100, 2) if k in FRACTION_KEYS else v
        facts["analyst"] = {k: info.get(k) for k in ANALYST_KEYS if info.get(k) is not None}
    except Exception as e:
        print(f"  ! {ticker} info: {e}", file=sys.stderr)

    today = pd.Timestamp.now(tz="UTC").normalize()
    try:
        ed = t.get_earnings_dates(limit=8)
        if ed is not None and len(ed):
            ed = ed.sort_index()
            idx = ed.index.tz_convert("UTC") if ed.index.tz is not None else ed.index.tz_localize("UTC")
            rows = [{"date": d.date().isoformat(), "epsEstimate": r.get("EPS Estimate"), "epsActual": r.get("Reported EPS"),
                     "surprisePct": r.get("Surprise(%)")} for d, (_, r) in zip(idx, ed.iterrows())]
            past = [r for r, d in zip(rows, idx) if d <= today and r["epsActual"] is not None and not pd.isna(r["epsActual"])]
            future = [r for r, d in zip(rows, idx) if d > today]
            facts["earnings"]["history"] = past[-4:]
            if future:
                facts["earnings"]["next"] = {"date": future[0]["date"], "epsEstimate": future[0]["epsEstimate"]}
    except Exception as e:
        print(f"  ! {ticker} earnings dates: {e}", file=sys.stderr)
    try:
        cal = t.calendar or {}
        dates = cal.get("Earnings Date") or []
        nxt = facts["earnings"].setdefault("next", {})
        if dates and not nxt.get("date"):
            nxt["date"] = str(dates[0])
        if cal.get("Revenue Average"):
            nxt["revenueEstimate"] = cal["Revenue Average"]
        if not nxt:
            facts["earnings"].pop("next")
    except Exception as e:
        print(f"  ! {ticker} calendar: {e}", file=sys.stderr)
    try:
        q = t.quarterly_income_stmt
        if q is not None and not q.empty:
            q = q.loc[[r for r in INCOME_ROWS if r in q.index]].iloc[:, :5]
            facts["earnings"]["quarterly"] = [
                {"period": str(col.date()), **{r: q.at[r, col] for r in q.index}} for col in q.columns
            ]
    except Exception as e:
        print(f"  ! {ticker} income: {e}", file=sys.stderr)
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        for n in t.news or []:
            c = n.get("content", n)
            pub = c.get("pubDate") or ""
            try:
                if datetime.fromisoformat(pub.replace("Z", "+00:00")) < cutoff:
                    continue
            except ValueError:
                pass
            url = (c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
            facts["news"].append({
                "title": c.get("title"), "summary": (c.get("summary") or "")[:300], "date": pub[:10],
                "publisher": (c.get("provider") or {}).get("displayName"), "url": url,
            })
            if len(facts["news"]) >= news_limit:
                break
    except Exception as e:
        print(f"  ! {ticker} news: {e}", file=sys.stderr)
    return clean(facts)


def load_market(market: str) -> dict:
    return json.loads((DATA_DIR / f"{market}.json").read_text(encoding="utf-8"))


def stock_context(market_data: dict, ticker: str) -> dict:
    """サイト用データから、その銘柄の基本情報・騰落率・所属テーマを取り出す。"""
    s = market_data["stocks"][ticker]
    themes = [g["name"] for g in market_data["groups"] if g["level"] == "theme" and ticker in g["tickers"]]
    tech_path = STOCK_DIR / market_data["market"] / f"{ticker}.json"
    tech = json.loads(tech_path.read_text(encoding="utf-8")) if tech_path.exists() else {}
    return {
        "ticker": ticker, "name": s["name"], "market": market_data["name"], "currency": market_data["currency"],
        "sector": s.get("sector"), "themes": themes, "asOf": market_data["asOf"], "close": s.get("close"),
        "returns": s.get("returns"), "capClass": s.get("capClass"), "beta": s.get("beta"),
        "technicals": tech.get("technicals", {}),
        "benchmarks": {b["name"]: b["returns"] for b in market_data["benchmarks"]},
    }


def build_prompt(ctx: dict, facts: dict) -> str:
    news = [{"index": i, **{k: n[k] for k in ("title", "summary", "date", "publisher")}} for i, n in enumerate(facts["news"])]
    payload = {
        "基準日": ctx["asOf"],
        "銘柄": {k: ctx[k] for k in ("ticker", "name", "market", "currency", "sector", "themes", "capClass")},
        "株価": {"終値": ctx["close"], "騰落率(%)": ctx["returns"], "β": ctx["beta"], "指数の騰落率(%)": ctx["benchmarks"]},
        "テクニカル指標": ctx["technicals"],
        "会社概要": facts["profile"],
        "財務指標（%の項目は%で表記）": facts["fundamentals"],
        "アナリスト予想": facts["analyst"],
        "決算": facts["earnings"],
        "ニュース（直近30日）": news,
    }
    return ("次の銘柄を解析してください。テクニカル指標の maDev は移動平均からの乖離率(%)、bbPos はボリンジャーバンド内の位置"
            "（0=-2σ、100=+2σ）、volRatio は20日平均に対する出来高の倍率、volatility は年率換算の変動率(%)です。\n\n"
            + json.dumps(payload, ensure_ascii=False, indent=1))


def request_params(prompt: str) -> dict:
    return {
        "model": CFG["model"],
        "max_tokens": 16000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": prompt}],
        "output_config": {"effort": CFG["effort"], "format": {"type": "json_schema", "schema": SCHEMA}},
    }


# ---------------------------------------------------------------- 保存

def out_path(market: str, ticker: str) -> Path:
    return OUT_DIR / market / f"{ticker}.json"


def save_result(item: dict, message) -> bool:
    """API の返答を検証して保存する。使えない返答なら False（次回また選ばれる）。"""
    if message.stop_reason != "end_turn":
        print(f"  ! {item['ticker']}: stop_reason={message.stop_reason}", file=sys.stderr)
        return False
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        ai = json.loads(text)
    except json.JSONDecodeError:
        print(f"  ! {item['ticker']}: JSONとして読めない返答", file=sys.stderr)
        return False
    save_ai(item, ai, message.model)
    return True


def safe_url(u):
    """ニュースのリンクは http(s) のものだけ使う。"""
    return u if isinstance(u, str) and u.startswith(("https://", "http://")) else None


def save_ai(item: dict, ai: dict, model: str) -> None:
    """検証済みの解析結果に、ニュースのリンクや上昇余地を足して保存する。"""
    news = item["facts"]["news"]
    for n in news:
        n["url"] = safe_url(n.get("url"))
    ai["news"]["items"] = [
        {**n, **{k: news[n["index"]][k] for k in ("title", "url", "date", "publisher")}}
        for n in ai["news"]["items"] if 0 <= n["index"] < len(news)
    ][:5]
    close = item["close"]
    tp = ai["targetPrice"]["price"]
    ai["targetPrice"]["upsidePct"] = round((tp / close - 1) * 100, 1) if close and tp else None
    rec = {
        "ticker": item["ticker"], "market": item["market"], "name": item["name"],
        "analyzedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "asOf": item["asOf"], "priceAtAnalysis": close, "model": model,
        "facts": {k: v for k, v in item["facts"].items() if k != "profile"} | {"profile": {
            k: v for k, v in item["facts"]["profile"].items() if k != "longBusinessSummary"}},
        "ai": ai,
    }
    p = out_path(item["market"], item["ticker"])
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")


def cost(model: str, inp: int, out: int, batch: bool) -> float:
    pi, po = PRICES.get(model, (0, 0))
    return (inp * pi + out * po) / 1e6 * (0.5 if batch else 1)


# ---------------------------------------------------------------- 銘柄の選び方

def pending_tickers() -> set[tuple[str, str]]:
    out = set()
    for p in PENDING_DIR.glob("*.json"):
        for it in json.loads(p.read_text(encoding="utf-8"))["items"].values():
            out.add((it["market"], it["ticker"]))
    return out


def select(limit: int) -> list[tuple[str, str]]:
    """解析する銘柄を優先順に選ぶ。

    1. 決算発表から数日以内で、決算後にまだ解析していない銘柄
    2. まだ一度も解析していない銘柄（時価総額の大きい順）
    3. 前回の解析から refresh_days 以上たった銘柄（古い順）
    """
    now = datetime.now(timezone.utc)
    today = now.date()
    busy = pending_tickers()
    urgent, fresh, stale = [], [], []
    for market in ("us", "jp"):
        md = load_market(market)
        for t, s in md["stocks"].items():
            if s.get("missing") or (market, t) in busy:
                continue
            p = out_path(market, t)
            if not p.exists():
                fresh.append((-(s.get("marketCap") or 0), market, t))
                continue
            rec = json.loads(p.read_text(encoding="utf-8"))
            at = datetime.fromisoformat(rec["analyzedAt"])
            nxt = (rec.get("facts", {}).get("earnings", {}).get("next") or {}).get("date")
            if nxt:
                d = date.fromisoformat(nxt[:10])
                if d <= today <= d + timedelta(days=CFG["earnings_priority_days"]) and at.date() <= d:
                    urgent.append((d.isoformat(), market, t))
                    continue
            if now - at >= timedelta(days=CFG["refresh_days"]):
                stale.append((rec["analyzedAt"], market, t))
    picked = [(m, t) for _, m, t in sorted(urgent)] + [(m, t) for _, m, t in sorted(fresh)] + [(m, t) for _, m, t in sorted(stale)]
    print(f"候補: 決算直後 {len(urgent)} / 未解析 {len(fresh)} / 更新時期 {len(stale)} / 解析待ち {len(busy)}")
    return picked[:limit]


def prepare(targets: list[tuple[str, str]]) -> list[dict]:
    """選んだ銘柄のデータを集めて、Claude に送る形にする。"""
    markets = {m: load_market(m) for m in {m for m, _ in targets}}

    def one(mt):
        m, t = mt
        ctx = stock_context(markets[m], t)
        facts = gather(t, CFG["news_limit"])
        time.sleep(0.3)  # Yahoo に負荷をかけすぎない
        return {"market": m, "ticker": t, "name": ctx["name"], "close": ctx["close"], "asOf": ctx["asOf"],
                "facts": facts, "prompt": build_prompt(ctx, facts)}

    with ThreadPoolExecutor(max_workers=4) as ex:
        return list(ex.map(one, targets))


# ---------------------------------------------------------------- コマンド

def client():
    import anthropic

    return anthropic.Anthropic()


def cmd_submit(args) -> None:
    targets = select(args.limit or CFG["max_per_run"])
    if not targets:
        print("解析が必要な銘柄はありません")
        return
    items = prepare(targets)
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    keyed = {f"r{i}": it for i, it in enumerate(items)}
    batch = client().messages.batches.create(requests=[
        Request(custom_id=k, params=MessageCreateParamsNonStreaming(**request_params(it["prompt"])))
        for k, it in keyed.items()
    ])
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    for it in keyed.values():
        it.pop("prompt")
    (PENDING_DIR / f"{batch.id}.json").write_text(json.dumps({
        "batchId": batch.id, "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": CFG["model"], "items": keyed,
    }, ensure_ascii=False), encoding="utf-8")
    print(f"バッチを送信: {batch.id}（{len(items)} 銘柄・{CFG['model']}）")


def cmd_collect(args) -> None:
    c = client()
    for p in sorted(PENDING_DIR.glob("*.json")):
        pend = json.loads(p.read_text(encoding="utf-8"))
        batch = c.messages.batches.retrieve(pend["batchId"])
        if batch.processing_status != "ended":
            age = datetime.now(timezone.utc) - datetime.fromisoformat(pend["createdAt"])
            if age > timedelta(hours=26):  # 期限切れのはず。片付けて次回選び直す
                c.messages.batches.cancel(pend["batchId"])
                p.unlink()
                print(f"バッチ {pend['batchId']} は終わらなかったので取り消しました")
            else:
                print(f"バッチ {pend['batchId']} は処理中です（{batch.request_counts.processing} 件）")
            continue
        ok = ng = inp = out = 0
        for r in c.messages.batches.results(pend["batchId"]):
            item = pend["items"].get(r.custom_id)
            if not item:
                continue
            if r.result.type == "succeeded":
                msg = r.result.message
                inp += msg.usage.input_tokens
                out += msg.usage.output_tokens
                if save_result(item, msg):
                    ok += 1
                    continue
            ng += 1
        p.unlink()
        print(f"バッチ {pend['batchId']}: 保存 {ok} 件・失敗 {ng} 件"
              f"（入力 {inp:,} / 出力 {out:,} トークン ≈ ${cost(pend['model'], inp, out, True):.2f}）")


def cmd_now(args) -> None:
    c = client()
    items = prepare([(args.market, t) for t in args.tickers])
    for it in items:
        msg = c.messages.create(**request_params(it["prompt"]))
        u = msg.usage
        saved = save_result(it, msg)
        print(f"{it['ticker']}: {'保存しました' if saved else '失敗'}（入力 {u.input_tokens:,} / 出力 {u.output_tokens:,}"
              f" トークン ≈ ${cost(CFG['model'], u.input_tokens, u.output_tokens, False):.3f}）")


def run_claude_code(prompt: str) -> tuple[dict, str]:
    """Claude Code を1回だけ呼び出し、スキーマどおりの解析結果を受け取る（ツールは使わせない）。"""
    import subprocess

    cmd = ["claude", "-p", "--output-format", "json", "--json-schema", json.dumps(SCHEMA, ensure_ascii=False),
           "--system-prompt", SYSTEM, "--tools", ""]
    if CFG.get("claude_code_model"):
        cmd += ["--model", CFG["claude_code_model"]]
    r = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=900)
    if r.returncode != 0:
        raise RuntimeError(f"Claude Code がエラーで終了しました: {(r.stderr or r.stdout)[-1500:]}")
    out = json.loads(r.stdout)
    if out.get("is_error"):
        raise RuntimeError(f"Claude Code のエラー: {str(out.get('result'))[:1500]}")
    ai = out.get("structured_output")
    if ai is None:  # 念のため、本文に書かれたJSONも読めるようにする
        text = str(out.get("result", "")).strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        ai = json.loads(text)
    models = list((out.get("modelUsage") or {}).keys())
    return ai, f"Claude Code（{models[0] if models else CFG.get('claude_code_model') or '既定のモデル'}）"


def cmd_claude(args) -> None:
    import jsonschema

    md = load_market(args.market)
    for t in args.tickers:
        if t not in md["stocks"] or md["stocks"][t].get("missing"):
            raise SystemExit(f"{t} は{md['name']}の銘柄一覧にありません")
    for it in prepare([(args.market, t) for t in args.tickers]):
        last = None
        for attempt in range(2):  # 形式が崩れたときだけ1回やり直す
            try:
                ai, model = run_claude_code(it["prompt"])
                jsonschema.validate(ai, SCHEMA)
                save_ai(it, ai, model)
                print(f"{it['ticker']}: 解析を保存しました（{model}）")
                break
            except (json.JSONDecodeError, jsonschema.ValidationError) as e:
                last = e
                print(f"  ! {it['ticker']}: 返答の形式が正しくありません（{attempt + 1}回目）: {e}", file=sys.stderr)
        else:
            raise SystemExit(f"{it['ticker']} の解析に失敗しました: {last}")


def cmd_prompt(args) -> None:
    for it in prepare([(args.market, t) for t in args.tickers]):
        print(it["prompt"])


def cmd_export(args) -> None:
    """解析結果をサイトに載せる。銘柄一覧の表で使う要約（星・判断・目標株価）も作る。"""
    import shutil

    src_root = Path(args.src) if args.src else OUT_DIR
    dst_root = ROOT / "web" / "public" / "analysis"
    for market in ("us", "jp"):
        dst = dst_root / market
        if dst.exists():
            shutil.rmtree(dst)
        dst.mkdir(parents=True)
        summary = {}
        for p in sorted((src_root / market).glob("*.json")):
            rec = json.loads(p.read_text(encoding="utf-8"))
            shutil.copy(p, dst / p.name)
            ai = rec["ai"]
            summary[rec["ticker"]] = {
                "stars": ai["rating"]["stars"], "action": ai["verdict"]["action"],
                "target": ai["targetPrice"]["price"], "upside": ai["targetPrice"].get("upsidePct"),
                "analyzedAt": rec["analyzedAt"][:10],
                "nextEarnings": (rec["facts"].get("earnings", {}).get("next") or {}).get("date"),
            }
        (dst_root / f"{market}.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"[{market}] 解析結果 {len(summary)} 銘柄をサイトに載せました")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("collect")
    e = sub.add_parser("export")
    e.add_argument("--from", dest="src", help="解析結果のフォルダ（省略時は data/analysis）")
    s = sub.add_parser("submit")
    s.add_argument("--limit", type=int)
    for name in ("now", "prompt", "claude"):
        s = sub.add_parser(name)
        s.add_argument("--market", choices=["us", "jp"], required=True)
        s.add_argument("tickers", nargs="+")
    args = ap.parse_args()

    if args.cmd == "claude" and not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        raise SystemExit("CLAUDE_CODE_OAUTH_TOKEN が設定されていません（claude setup-token で作ったトークンを登録してください）")
    if args.cmd not in ("prompt", "export", "claude") and not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY が設定されていないので、AI解析は行いません")
        return
    {"collect": cmd_collect, "submit": cmd_submit, "now": cmd_now, "prompt": cmd_prompt, "export": cmd_export, "claude": cmd_claude}[args.cmd](args)


if __name__ == "__main__":
    main()
