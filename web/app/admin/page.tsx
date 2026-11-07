"use client";

import { useEffect, useState } from "react";
import { checkToken, getToken, REPO, setToken } from "@/lib/admin";

// 管理者用の設定ページ（メニューには出さない）。
// GitHub のトークンをこのブラウザに保存すると、銘柄ページに「AI解析」ボタンが表示される。
export default function Admin() {
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSaved(getToken()), []);

  const save = async () => {
    const tk = input.trim();
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      await checkToken(tk);
      setToken(tk);
      setSaved(tk);
      setInput("");
      setMsg({ ok: true, text: "保存しました。銘柄ページに「AI解析」ボタンが表示されます。" });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message || e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prose">
      <h1>管理者設定</h1>
      <p>
        このブラウザに GitHub のアクセストークンを保存すると、銘柄ページに「AI解析」ボタンが表示されます。
        トークンはこのブラウザの中だけに保存され、サイトや他の人には送られません。
      </p>

      <div className="panel section">
        <h2>状態</h2>
        <p>{saved ? <span className="up">トークン保存済み（…{saved.slice(-4)}）</span> : <span className="muted">トークン未設定</span>}</p>
        <div className="toolbar">
          <input className="search" type="password" placeholder="github_pat_…" value={input}
            onChange={(e) => setInput(e.target.value)} style={{ minWidth: 280 }} aria-label="GitHub トークン" />
          <button className="ai-button" onClick={save} disabled={busy || !input.trim()}>{busy ? "確認中…" : "確認して保存"}</button>
          {saved && (
            <button className="chip" onClick={() => { setToken(null); setSaved(null); setMsg({ ok: true, text: "削除しました" }); }}>
              削除
            </button>
          )}
        </div>
        {msg && <p className={msg.ok ? "up" : "down"}>{msg.text}</p>}
      </div>

      <h2>トークンの作り方</h2>
      <ol>
        <li>GitHub の Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
        <li>Repository access で <b>Only select repositories</b> を選び、<code>{REPO}</code> だけを選ぶ</li>
        <li>Permissions の Repository permissions で <b>Actions</b> を <b>Read and write</b> にする（ほかは不要）</li>
        <li>作ったトークンを上の欄に貼り付けて保存</li>
      </ol>
      <p className="muted small">
        このトークンでできるのは、このリポジトリの GitHub Actions の実行だけです。
        共用のパソコンでは使い終わったら「削除」を押してください。
      </p>
    </div>
  );
}
