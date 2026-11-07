"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { findRun, getRun, getToken, loadRuns, saveRun, startAnalysis, type RunInfo } from "@/lib/admin";
import type { Market } from "@/lib/types";

type State =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "running"; run: RunInfo | null; since: number }
  | { phase: "done" }
  | { phase: "error"; message: string; url?: string };

/**
 * 管理者だけに表示する「AI解析」ボタン。
 * 押すと GitHub Actions でこの銘柄の解析を始め、終わるまで進み具合を表示する。
 * 終わったら onDone を呼んで、新しい解析結果を読み込み直してもらう。
 */
export default function AnalyzeButton({ market, ticker, hasAnalysis, onDone }: {
  market: Market;
  ticker: string;
  hasAnalysis: boolean;
  onDone: () => void;
}) {
  const [token, setTok] = useState<string | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const key = `${market}:${ticker}`;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async (tk: string, since: number, runId?: number) => {
    try {
      const run = runId ? await getRun(tk, runId) : await findRun(tk, market, ticker, since);
      if (run && run.status === "completed") {
        saveRun(key, null);
        if (run.conclusion === "success") {
          setState({ phase: "done" });
          onDone();
        } else {
          setState({ phase: "error", message: `解析に失敗しました（${run.conclusion}）`, url: run.html_url });
        }
        return;
      }
      if (run) saveRun(key, { since, runId: run.id });
      setState({ phase: "running", run, since });
      if (Date.now() - since > 40 * 60_000) {
        setState({ phase: "error", message: "時間がかかりすぎています。GitHub の Actions を確認してください", url: run?.html_url });
        saveRun(key, null);
        return;
      }
      timer.current = setTimeout(() => poll(tk, since, run?.id), 10_000);
    } catch (e) {
      setState({ phase: "error", message: String((e as Error).message || e) });
    }
  }, [key, market, ticker, onDone]);

  useEffect(() => {
    const tk = getToken();
    setTok(tk);
    // 実行中の解析があれば続きから追う
    const saved = loadRuns()[key];
    if (tk && saved && Date.now() - saved.since < 40 * 60_000) {
      setState({ phase: "running", run: null, since: saved.since });
      poll(tk, saved.since, saved.runId);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, poll]);

  if (!token) return null; // 管理者以外には何も表示しない

  const start = async () => {
    setState({ phase: "starting" });
    const since = Date.now();
    try {
      await startAnalysis(token, market, ticker);
      saveRun(key, { since });
      setState({ phase: "running", run: null, since });
      timer.current = setTimeout(() => poll(token, since), 8_000);
    } catch (e) {
      setState({ phase: "error", message: String((e as Error).message || e) });
    }
  };

  const busy = state.phase === "starting" || state.phase === "running";
  const elapsed = state.phase === "running" ? Math.floor((Date.now() - state.since) / 60_000) : 0;

  return (
    <div className="admin-bar">
      <button className="ai-button" onClick={start} disabled={busy}>
        {busy ? "AI解析中…" : hasAnalysis ? "AI解析をやり直す" : "AI解析を実行"}
      </button>
      <span className="small muted">
        {state.phase === "idle" && "管理者のみ表示。株価の更新・解析・公開まで5分ほどかかります"}
        {state.phase === "starting" && "GitHub Actions に依頼しています…"}
        {state.phase === "running" && (
          <>
            {state.run?.status === "queued" ? "順番待ち" : "解析・公開中"}（{elapsed}分経過）
            {state.run && <> ・<a href={state.run.html_url} target="_blank" rel="noreferrer">進み具合</a></>}
          </>
        )}
        {state.phase === "done" && <span className="up">解析が終わり、表示を更新しました</span>}
        {state.phase === "error" && (
          <span className="down">
            {state.message}
            {state.url && <> ・<a href={state.url} target="_blank" rel="noreferrer">ログを見る</a></>}
          </span>
        )}
      </span>
    </div>
  );
}
