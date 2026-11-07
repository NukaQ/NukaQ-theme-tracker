# テーマトラッカー

米国株・日本株を「AI半導体」「防衛」「インバウンド」などのテーマでまとめ、テーマごとの騰落率をランキングとマップで見られるWebサイトです。

## できること

| ページ | 内容 |
|---|---|
| ランキング | テーマを騰落率順に並べる。期間（1D〜1Y）と階層（セクター／サブセクター／大テーマ／テーマ）を切り替え。上昇銘柄の割合、過去20日の順位推移つき |
| マップ | テーマごとに銘柄をタイル表示し、騰落率で色分け（大きさは時価総額か均等） |
| テーマ詳細 | 指数（S&P500・NASDAQ100 / TOPIX・日経平均）と比べたチャート、内訳、構成銘柄 |
| 銘柄 | S&P500・日経225の全構成銘柄（＋テーマに入れたそれ以外の銘柄）の一覧。52週高値からの下落率・移動平均乖離・出来高倍率・βで並べ替え、業種・時価総額・テーマの有無で絞り込み |
| 銘柄ページ | 銘柄をクリックすると表示。AI解析（★5段階評価・直近の売買判断・目標株価）、移動平均つきチャート、テクニカル解析、ファンダメンタルズ解析、直近の決算解析と次回決算日、直近のニュース |
| お気に入り | ☆を付けたテーマと銘柄（ブラウザに保存、ログイン不要） |

上昇色は緑／赤を切り替え可能。ダークモード・スマホ表示に対応。

## しくみ

```
config/universe/*.csv     S&P500・日経225 の構成銘柄一覧（月1回 Wikipedia から自動更新）
config/us.yaml, jp.yaml   テーマと銘柄の定義（ここを編集してテーマを増やす）
        │
scripts/update_data.py    Yahoo Finance から株価を取得して騰落率などを計算
        │
web/public/data/*.json    計算結果
        │
web/ (Next.js)            JSONを読んで表示する静的サイト → GitHub Pages
```

サーバーもデータベースも不要です。GitHub Actions が1日2回（日本株の大引け後・米国株の取引終了後）に株価を取り直してサイトを公開し直します。

## 手元で動かす

```bash
pip install -r requirements.txt
python scripts/update_data.py          # 実データ（--sample でネット不要のサンプルデータ）
cd web && npm install && npm run dev   # http://localhost:3000
```

## 公開する（GitHub Pages）

1. このフォルダを GitHub リポジトリに push する
2. リポジトリの Settings → Pages → Source を「GitHub Actions」にする
3. Actions タブの「Update data and deploy」を一度手動で実行する

`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

## AI解析（管理者が押した銘柄だけ）

銘柄ページの「AI解析」ボタンを押すと、GitHub Actions がその銘柄の株価・テクニカル指標と Yahoo Finance の
財務・アナリスト予想・決算・ニュースを集め、**Claude Code（Claude の有料プラン）** で解析して、5分ほどでサイトに反映します。
API の従量課金はかかりません（有料プランの使用量を消費します）。

ボタンは、GitHub のトークンを保存したブラウザにだけ表示されます。トークンを持たない人は解析を起動できません。

### 準備（最初の1回）

1. **Claude のトークンを登録**: 手元のパソコンで `claude setup-token` を実行（ブラウザで Claude にログイン）し、
   表示されたトークンをリポジトリの Settings → Secrets and variables → Actions に `CLAUDE_CODE_OAUTH_TOKEN` という名前で登録
2. **GitHub のトークンを作る**: GitHub の Settings → Developer settings → Fine-grained tokens で、
   このリポジトリだけ・権限は **Actions: Read and write** だけのトークンを作る
3. **ブラウザに保存**: サイトの `/admin/` を開き、2 のトークンを貼り付けて保存（メニューには出ない管理者ページ）

### しくみ

- ボタン → GitHub Actions の「Update data and deploy」を `market`・`ticker` 付きで起動 → `python scripts/analyze.py claude --market us NVDA`
  → 結果を `data/analysis/` にコミット → サイトを作り直して公開
- 使うモデルは `config/analysis.yaml` の `claude_code_model`（空ならアカウントの既定）
- `scripts/analyze.py` には Anthropic API（従量課金）で全銘柄を順番に解析する `submit` / `collect` も残してあります（いまは未使用）

## 対象銘柄

- 米国株: S&P500 の全構成銘柄（約500）＋テーマに入れたS&P500以外の銘柄（Arm、IonQ など）
- 日本株: 日経225 の全構成銘柄＋テーマに入れたそれ以外の銘柄（ローツェ、東京応化 など）

構成銘柄一覧は `scripts/update_universe.py` が Wikipedia から取得します（GitHub Actions で毎月1日に自動実行）。
すべての銘柄は「銘柄」ページに出ますが、テーマに入れるかどうかは `config/*.yaml` で決めます。

## テーマを追加・変更する

`config/us.yaml` か `config/jp.yaml` を編集します。

```yaml
- name: 光接続                                  # テーマ名
  tickers: [COHR, LITE, CIEN, {FN: Fabrinet}]   # 指数の銘柄はティッカーだけ、それ以外は {ティッカー: 表示名}
```

日本株は `8035` のように証券コードだけ書けば `.T` が自動で付きます。同じ銘柄を複数のテーマに入れても構いません。
YAML では `ON` や `YES` などが真偽値と解釈されるので、そういうティッカーは `"ON"` のように引用符で囲んでください。

## 計算方法

- **テーマの騰落率**: 構成銘柄の日次騰落率を単純平均して積み上げた指数で計算（時価総額加重ではない）
- **期間**: 1D=1営業日, 5D, 10D, 1M=21営業日, 2M=42, 3M=63, 6M=126, 1Y=252
- **β**: 過去1年の日次騰落率から、S&P500（米国株）/ TOPIX（日本株）に対する感応度
- **時価総額区分**: Mega ≥ $200B / Large ≥ $10B / Mid ≥ $2B / Small ≥ $250M / Micro（日本株は1ドル150円換算）
- Yahoo のデータで株式分割が反映されていない箇所は自動で補正します（ログに `~` で表示）

## 注意

- 株価は Yahoo Finance の非公式APIから取得しています（yfinance）。個人利用・学習用途向けで、商用で公開する場合は有料のデータ提供元（Polygon.io、J-Quants など）への切り替えを検討してください。
- 掲載情報は投資判断の参考情報であり、売買を推奨するものではありません。
