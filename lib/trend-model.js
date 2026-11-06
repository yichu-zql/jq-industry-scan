import {
  indexIndustry,
  aggregate,
  pairedAggregate,
  ratio,
  yoy,
  isKnown,
  PLATFORMS,
  shift,
} from "./metrics.js";
export const CHANNEL_COLORS = ["#E6004C", "#FFD166", "#FF0080"];
export const CATEGORY_COLORS = [
  "#E6004C",
  "#FFC000",
  "#FFE699",
  "#FF679D",
  "#F7C6D9",
  "#F4B183",
  "#B8C6DB",
  "#84A9AC",
  "#B6A1D5",
  "#A9CA8D",
];
export const percent = (v) =>
  Number.isFinite(v) ? (v * 100).toFixed(2) + "%" : "—";
export const number = (v) =>
  !Number.isFinite(v)
    ? "—"
    : Math.abs(v) >= 1e12
      ? (v / 1e12).toFixed(2) + "万亿"
      : Math.abs(v) >= 1e8
        ? (v / 1e8).toFixed(2) + "亿"
        : Math.abs(v) >= 1e4
          ? (v / 1e4).toFixed(2) + "万"
          : v.toLocaleString("zh-CN", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
export const commonUnit = (values) => {
  const max = Math.max(...values.filter(Number.isFinite).map(Math.abs), 0);
  return max >= 1e12
    ? { scale: 1e12, label: "万亿元" }
    : max >= 1e8
      ? { scale: 1e8, label: "亿元" }
      : max >= 1e4
        ? { scale: 1e4, label: "万元" }
        : { scale: 1, label: "元" };
};
export function trendPeriods(f) {
  return Array.from({ length: f.endYear - f.startYear + 1 }, (_, i) => {
    const year = f.startYear + i,
      end = year * 100 + (year === f.endYear ? f.cutoff : 12);
    return {
      start: year * 100 + 1,
      end,
      label: year + "年" + (end % 100 === 12 ? "" : "1—" + (end % 100) + "月"),
    };
  });
}
export function marketTrends(industry, f) {
  const selected = new Set(f.ids),
    cats = industry.categories.filter((c) => selected.has(c.id)),
    ids = cats.map((c) => c.id),
    index = indexIndustry(industry.rows),
    periods = trendPeriods(f);
  const totals = periods.map((p) =>
      aggregate(index, ids, f.plats, p.start, p.end),
    ),
    pairs = periods.map((p) =>
      pairedAggregate(index, ids, f.plats, p.start, p.end),
    );
  const growth = pairs.map((p, i) => (i ? yoy(p.cur.g, p.prev.g) : null));
  const channels = f.plats.map((p) => ({
    name: PLATFORMS[p],
    color: CHANNEL_COLORS[p],
    values: totals.map((t) =>
      t.byPlat.find((v) => v.p === p)?.present
        ? t.byPlat.find((v) => v.p === p).g
        : null,
    ),
  }));
  let common = cats[0]?.path.slice() || [];
  while (
    common.length &&
    !cats.every((c) => common.every((s, i) => c.path[i] === s))
  )
    common.pop();
  const depth = f.depth ? Number(f.depth) : Math.min(common.length + 1, 3),
    groups = new Map();
  for (const c of cats) {
    const key = JSON.stringify(c.path.slice(0, depth));
    if (!groups.has(key))
      groups.set(key, { name: c.path.slice(0, depth).join(" / "), ids: [] });
    groups.get(key).ids.push(c.id);
  }
  let series = [...groups]
    .map(([key, v]) => ({
      ...v,
      key,
      values: periods.map(
        (p) => aggregate(index, v.ids, f.plats, p.start, p.end).g,
      ),
    }))
    .sort(
      (a, b) =>
        (b.values.at(-1) || 0) - (a.values.at(-1) || 0) ||
        a.key.localeCompare(b.key),
    );
  const limit = f.top || 6;
  if (series.length > limit) {
    const rest = series.slice(limit);
    series = [
      ...series.slice(0, limit),
      {
        name: "其他",
        key: "other",
        ids: rest.flatMap((v) => v.ids),
        values: periods.map((_, i) =>
          rest.some((v) => v.values[i] !== null)
            ? rest.reduce((s, v) => s + (v.values[i] || 0), 0)
            : null,
        ),
      },
    ];
  }
  series = series.map((v, i) => ({
    ...v,
    color:
      v.key === "other"
        ? "#BBC2CC"
        : CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));
  const base = {
    labels: periods.map((p) => p.label),
    growth,
    totals: totals.map((v) => v.g),
    pairCurrent: pairs.map((v) => v.cur.g),
    pairPrevious: pairs.map((v) => v.prev.g),
    coverage: pairs.map((v, i) => ratio(v.cur.g, totals[i].g)),
    periods,
  };
  return {
    channels: { ...base, title: "分平台行业规模趋势", series: channels },
    categories: { ...base, title: "细分类目GMV（退后）变化趋势", series },
    count: ids.length,
  };
}
export function compareBrands(parts, f) {
  const end = f.endYear * 100 + f.cutoff,
    start = f.endYear * 100 + 1,
    oldEnd = shift(end, -12),
    oldStart = shift(start, -12),
    cur = new Map(),
    prev = new Map();
  const add = (map, name, p, g) => {
    if (!map.has(name)) map.set(name, { name, g: 0, plats: {} });
    const v = map.get(name);
    v.g += g;
    v.plats[p] = (v.plats[p] || 0) + g;
  };
  for (const d of parts) {
    const rows = Array.isArray(d) ? d : d.rows;
    for (const r of rows) {
      if (!f.plats.includes(r[1]) || !Number.isFinite(r[3])) continue;
      const name = Array.isArray(d) ? r[2] : d.labels[r[2]];
      if (r[0] >= start && r[0] <= end) add(cur, name, r[1], r[3]);
      if (r[0] >= oldStart && r[0] <= oldEnd) add(prev, name, r[1], r[3]);
    }
  }
  const rank = (map) =>
    [...map.values()]
      .filter((v) => isKnown(v.name))
      .sort((a, b) => b.g - a.g || a.name.localeCompare(b.name));
  const a = rank(cur),
    b = rank(prev);
  const sum = (map) =>
    map.size ? [...map.values()].reduce((s, v) => s + v.g, 0) : null;
  const total = sum(cur),
    previousTotal = sum(prev),
    top = a.slice(0, 5).map((r, i) => ({
      ...r,
      rank: i + 1,
      share: ratio(r.g, total),
      newTop: b.length > 0 && !b.slice(0, 5).some((v) => v.name === r.name),
    })),
    oldTop = b
      .slice(0, 5)
      .map((r, i) => ({ ...r, rank: i + 1, share: ratio(r.g, previousTotal) }));
  const cr5 = top.length
      ? ratio(
          top.reduce((s, v) => s + v.g, 0),
          total,
        )
      : null,
    priorCr5 = oldTop.length
      ? ratio(
          oldTop.reduce((s, v) => s + v.g, 0),
          previousTotal,
        )
      : null;
  const highlights = top.slice(0, 3).map((r) => {
    const old = prev.get(r.name),
      share0 = ratio(old?.g, previousTotal),
      gains = f.plats
        .filter(
          (p) => Number.isFinite(r.plats[p]) && Number.isFinite(old?.plats[p]),
        )
        .map((p) => ({ p, delta: r.plats[p] - old.plats[p] }))
        .sort((a, b) => b.delta - a.delta);
    return {
      ...r,
      y: yoy(r.g, old?.g),
      shareChange:
        r.share !== null && share0 !== null ? r.share - share0 : null,
      gain: gains[0] || null,
      mainPlatform: f.plats
        .filter((p) => Number.isFinite(r.plats[p]))
        .sort((a, b) => r.plats[b] - r.plats[a])[0],
    };
  });
  return {
    top,
    oldTop,
    total,
    previousTotal,
    cr5,
    priorCr5,
    highlights,
    start,
    end,
    oldStart,
    oldEnd,
  };
}
