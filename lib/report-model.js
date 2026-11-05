import { shift, months, ratio, yoy, isKnown } from "./metrics.js";
export const reportRules =
  "三级类目：≥3个月、所选市场份额≥1%、可比金额覆盖≥80%、同比≥10%且领先所选市场≥5pp；按可比增量排序。";
const fresh = () => ({
  g: 0,
  q: 0,
  prev: 0,
  pairG: 0,
  pairPrev: 0,
  n: 0,
  pairs: 0,
  qtyValid: true,
});
function add(v, r, b) {
  v.g += r[4];
  v.q += r[5] ?? 0;
  v.qtyValid &&= Number.isFinite(r[5]);
  v.n++;
  if (b && Number.isFinite(b[4])) {
    v.pairG += r[4];
    v.pairPrev += b[4];
    v.pairs++;
  }
}
function finish(v) {
  return {
    ...v,
    g: v.n ? v.g : null,
    q: v.n && v.qtyValid ? v.q : null,
    y: yoy(v.pairG, v.pairPrev),
    coverage: ratio(v.pairG, v.g),
    delta: v.pairs ? v.pairG - v.pairPrev : null,
  };
}
export function computeReport(rows, categories, filter) {
  const ids = new Set(filter.ids),
    plats = new Set(filter.plats),
    bands = new Set(filter.bands),
    all = rows.filter(
      (r) => ids.has(r[0]) && plats.has(r[2]) && Number.isFinite(r[4]),
    );
  const lookup = new Map(all.map((r) => [r.slice(0, 4).join("|"), r])),
    total = fresh(),
    cats = new Map(),
    prices = new Map(),
    trend = new Map(),
    platforms = new Map();
  let allG = 0;
  for (const r of all) {
    if (r[1] < filter.start || r[1] > filter.end) continue;
    allG += r[4];
    if (bands.size && !bands.has(r[3])) continue;
    const b = lookup.get([r[0], shift(r[1], -12), r[2], r[3]].join("|"));
    add(total, r, b);
    for (const [map, key] of [
      [cats, r[0]],
      [prices, r[3]],
      [trend, r[1]],
      [platforms, r[2]],
    ]) {
      if (!map.has(key)) map.set(key, fresh());
      add(map.get(key), r, b);
    }
  }
  const t = finish(total),
    categoryMap = new Map(categories.map((c) => [c.id, c]));
  const entries = [...cats].map(([id, v]) => ({
    ...finish(v),
    id,
    path: categoryMap.get(id).path,
  }));
  const candidate = entries
    .filter(
      (c) =>
        t.coverage >= 0.8 &&
        months(filter.start, filter.end).length >= 3 &&
        c.g > 0 &&
        c.g >= t.g * 0.01 &&
        c.coverage >= 0.8 &&
        c.y >= 0.1 &&
        t.y !== null &&
        c.y >= t.y + 0.05 &&
        c.delta > 0,
    )
    .sort((a, b) => b.delta - a.delta || a.id.localeCompare(b.id));
  const common = filter.path || [];
  const depth = Math.min(common.length, 2);
  const structure = new Map();
  for (const c of entries) {
    const name = c.path[depth];
    if (!structure.has(name))
      structure.set(name, { name, g: 0, pairG: 0, pairPrev: 0 });
    const v = structure.get(name);
    v.g += c.g;
    v.pairG += c.pairG;
    v.pairPrev += c.pairPrev;
  }
  return {
    total: t,
    allG,
    selectionShare: ratio(t.g, allG),
    candidates: candidate.slice(0, 3),
    candidateCount: candidate.length,
    examined: entries.length,
    structure: [...structure.values()]
      .map((v) => ({ ...v, y: yoy(v.pairG, v.pairPrev) }))
      .sort((a, b) => b.g - a.g)
      .slice(0, 5),
    prices: [...prices]
      .map(([band, v]) => ({ band, ...finish(v) }))
      .sort((a, b) => a.band - b.band),
    trend: months(filter.start, filter.end).map((month) => ({
      month,
      ...finish(trend.get(month) || fresh()),
    })),
    platforms: [...platforms].map(([p, v]) => ({ p, ...finish(v) })),
    filter,
  };
}
export function bandOpportunity(rows, id, filter) {
  const r = computeReport(rows, [{ id, path: ["", "", ""] }], {
    ...filter,
    ids: [id],
  });
  const growing = r.prices
    .filter((v) => v.band >= 0 && v.y > 0 && v.coverage >= 0.8 && v.delta > 0)
    .sort((a, b) => b.delta - a.delta);
  const selected =
    growing[0] ||
    r.prices.filter((v) => v.band >= 0).sort((a, b) => b.g - a.g)[0];
  return selected
    ? {
        ...selected,
        reason: growing.length ? "增量领先价位" : "主销价位（待验证增长）",
      }
    : null;
}
export function brandEvidence(chunks, filter) {
  const map = new Map();
  let total = 0;
  for (const d of chunks) {
    const rows = Array.isArray(d) ? d : d.rows;
    for (const r of rows) {
      if (
        r[0] < filter.start ||
        r[0] > filter.end ||
        !filter.plats.includes(r[1]) ||
        (filter.bands.length && !filter.bands.includes(r[3])) ||
        !Number.isFinite(r[4])
      )
        continue;
      const name = Array.isArray(d) ? r[2] : d.labels[r[2]];
      total += r[4];
      if (isKnown(name)) map.set(name, (map.get(name) || 0) + r[4]);
    }
  }
  const rank = [...map]
    .map(([name, g]) => ({ name, g, share: ratio(g, total) }))
    .sort((a, b) => b.g - a.g || a.name.localeCompare(b.name));
  return {
    total,
    top: rank.slice(0, 5),
    cr5: rank.length
      ? ratio(
          rank.slice(0, 5).reduce((s, r) => s + r.g, 0),
          total,
        )
      : null,
    identified: ratio(
      rank.reduce((s, r) => s + r.g, 0),
      total,
    ),
  };
}
