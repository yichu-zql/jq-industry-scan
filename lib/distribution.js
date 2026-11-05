import { isKnown, ratio, yoy, shift } from "./metrics.js";

// Exact aggregation before ranking; unknown brands stay in the denominator.
export function distributionAccumulator(start, end) {
  const groups = new Map();
  return {
    add(key, month, name, g, q) {
      const current = month >= start && month <= end;
      const prior = month >= shift(start, -12) && month <= shift(end, -12);
      if (!current && !prior) return;
      if (!groups.has(key)) groups.set(key, [new Map(), new Map()]);
      const map = groups.get(key)[current ? 0 : 1];
      const v = map.get(name) || { name, g: 0, q: 0 };
      v.g += g ?? 0;
      v.q += q ?? 0;
      map.set(name, v);
    },
    result() {
      return [...groups].map(([key, [cur, prev]]) => {
        const all = [...cur.values()].sort((a, b) => b.g - a.g);
        const total = all.reduce((s, r) => s + r.g, 0);
        const prior = [...prev.values()].reduce((s, r) => s + r.g, 0);
        const top = all.filter((r) => isKnown(r.name)).slice(0, 5);
        return {
          key,
          g: total,
          y: cur.size && prev.size ? yoy(total, prior) : null,
          cr5: ratio(
            top.reduce((s, r) => s + r.g, 0),
            total,
          ),
          top: top.map((r) => ({
            ...r,
            y: prev.has(r.name) ? yoy(r.g, prev.get(r.name).g) : null,
            cr5: null,
          })),
        };
      });
    },
  };
}

export function seaColor(cr5) {
  if (!Number.isFinite(cr5)) return "#9299a5";
  const c = Math.max(0, Math.min(1, cr5));
  return c < 0.3
    ? `hsl(214 76% ${43 + (25 * c) / 0.3}%)`
    : `hsl(2 73% ${70 - (32 * (c - 0.3)) / 0.7}%)`;
}
