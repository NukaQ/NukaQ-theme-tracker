"use client";

import { useCallback, useEffect, useState } from "react";

// お気に入りはこのブラウザの中だけに保存する（ログイン不要）
const KEY = "tt:favorites:v1";
const EVENT = "tt:favorites-changed";

export interface Favorites {
  groups: string[]; // "us:グループID"
  stocks: string[]; // "us:NVDA"
}

function read(): Favorites {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const f = JSON.parse(raw);
      return { groups: f.groups ?? [], stocks: f.stocks ?? [] };
    }
  } catch {}
  return { groups: [], stocks: [] };
}

function write(f: Favorites) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function useFavorites() {
  const [fav, setFav] = useState<Favorites>({ groups: [], stocks: [] });

  useEffect(() => {
    const sync = () => setFav(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((kind: keyof Favorites, key: string) => {
    const f = read();
    const list = f[kind];
    f[kind] = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
    write(f);
  }, []);

  return { fav, toggle };
}
