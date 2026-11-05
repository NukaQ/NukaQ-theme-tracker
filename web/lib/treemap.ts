// 面積が値に比例するように長方形を敷き詰める（squarified treemap）。

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

export function squarify<T>(items: T[], value: (t: T) => number, rect: Rect): Tile<T>[] {
  const list = items
    .map((item) => ({ item, v: Math.max(0, value(item)) }))
    .filter((d) => d.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = list.reduce((s, d) => s + d.v, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];

  const scale = (rect.w * rect.h) / total;
  const nodes = list.map((d) => ({ item: d.item, a: d.v * scale }));
  const out: Tile<T>[] = [];
  let { x, y, w, h } = rect;
  let row: typeof nodes = [];

  const worst = (r: typeof nodes, side: number) => {
    const s = r.reduce((acc, n) => acc + n.a, 0);
    let max = 0, min = Infinity;
    for (const n of r) {
      max = Math.max(max, n.a);
      min = Math.min(min, n.a);
    }
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const layoutRow = (r: typeof nodes) => {
    const s = r.reduce((acc, n) => acc + n.a, 0);
    if (w >= h) {
      const rw = s / h;
      let cy = y;
      for (const n of r) {
        const nh = n.a / rw;
        out.push({ item: n.item, x, y: cy, w: rw, h: nh });
        cy += nh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const n of r) {
        const nw = n.a / rh;
        out.push({ item: n.item, x: cx, y, w: nw, h: rh });
        cx += nw;
      }
      y += rh;
      h -= rh;
    }
  };

  for (const n of nodes) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) {
      row.push(n);
    } else {
      layoutRow(row);
      row = [n];
    }
  }
  if (row.length) layoutRow(row);
  return out;
}
