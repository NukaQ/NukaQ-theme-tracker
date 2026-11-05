"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "ランキング" },
  { href: "/map/", label: "マップ" },
  { href: "/stocks/", label: "銘柄" },
  { href: "/favorites/", label: "お気に入り" },
  { href: "/about/", label: "使い方" },
];

function Nav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  // ページを移っても市場と期間は引き継ぐ
  const keep = new URLSearchParams();
  for (const k of ["m", "p"]) {
    const v = sp.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString() ? `?${keep.toString()}` : "";
  const norm = (p: string) => (p.endsWith("/") ? p : `${p}/`);

  return (
    <nav className="nav" aria-label="メインメニュー">
      {NAV.map((n) => (
        <Link key={n.href} href={`${n.href}${qs}`} className={norm(pathname) === n.href ? "on" : ""}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function ColorToggle() {
  // 上昇を緑にするか赤にするか（日本の証券会社は赤が多い）
  const [mode, setMode] = useState<"green" | "red">("green");
  useEffect(() => {
    setMode(document.documentElement.dataset.updown === "red" ? "red" : "green");
  }, []);
  const flip = () => {
    const next = mode === "green" ? "red" : "green";
    setMode(next);
    document.documentElement.dataset.updown = next;
    try { localStorage.setItem("tt:updown", next); } catch {}
  };
  return (
    <button className="colortoggle" onClick={flip} title="上昇・下落の色を切り替える">
      上昇<span className="dot" style={{ background: "var(--up)" }} />
      下落<span className="dot" style={{ background: "var(--down)" }} />
    </button>
  );
}

export default function Header() {
  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <span className="logo" aria-hidden>▦</span> テーマトラッカー
        </Link>
        <Suspense fallback={<nav className="nav" />}>
          <Nav />
        </Suspense>
        <ColorToggle />
      </div>
    </header>
  );
}
