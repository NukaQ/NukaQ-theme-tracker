"use client";

// 管理者だけが使う「AI解析」ボタンのための GitHub 操作。
// GitHub のアクセストークンは管理者のブラウザ（localStorage）だけに保存し、サイトのファイルには含めない。
// トークンがなければボタンは表示されず、GitHub Actions を起動することもできない。

import type { Market } from "./types";

const TOKEN_KEY = "tt:admin:github-token";
const RUNS_KEY = "tt:admin:runs";
export const REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "NukaQ/NukaQ-theme-tracker";
export const WORKFLOW = "update-and-deploy.yml";
const API = "https://api.github.com";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function gh(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) {
    const msg = r.status === 401 ? "トークンが無効です" : r.status === 403 || r.status === 404 ? "トークンに権限がありません（Actions: Read and write が必要）" : `GitHub エラー ${r.status}`;
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

/** トークンでワークフローを操作できるか確かめる。 */
export async function checkToken(token: string) {
  await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}`, token);
}

export interface RunInfo {
  id: number;
  status: string; // queued / in_progress / completed
  conclusion: string | null; // success / failure / cancelled
  html_url: string;
  created_at: string;
  display_title: string;
}

/** 銘柄のAI解析を GitHub Actions で開始する。 */
export async function startAnalysis(token: string, market: Market, ticker: string) {
  await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, token, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { market, ticker } }),
  });
}

/** 開始した実行を探す（開始直後は一覧に出るまで少しかかる）。 */
export async function findRun(token: string, market: Market, ticker: string, since: number): Promise<RunInfo | null> {
  const data = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`, token);
  const title = `AI解析 ${market} ${ticker}`;
  const runs: RunInfo[] = data.workflow_runs ?? [];
  return runs.find((r) => r.display_title === title && new Date(r.created_at).getTime() >= since - 60_000) ?? null;
}

export async function getRun(token: string, id: number): Promise<RunInfo> {
  return gh(`/repos/${REPO}/actions/runs/${id}`, token);
}

// ページを開き直しても進み具合を追えるよう、実行中の解析を覚えておく
type Saved = Record<string, { since: number; runId?: number }>;

export function loadRuns(): Saved {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveRun(key: string, v: { since: number; runId?: number } | null) {
  const all = loadRuns();
  if (v) all[key] = v;
  else delete all[key];
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(all));
  } catch {}
}
