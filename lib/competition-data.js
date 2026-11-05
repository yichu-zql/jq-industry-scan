import { isKnown, shift } from "./metrics.js";
export function prepareCompetitionChunk(data) {
  const groups = new Map(),
    labels = Array.isArray(data) ? null : data.labels,
    rows = Array.isArray(data) ? data : data.rows;
  for (const r of rows) {
    const key = r[0] + "|" + r[1];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return { groups, labels, size: rows.length };
}
function add(map, name, g, q) {
  let r = map.get(name);
  if (!r) {
    r = { name, g: 0, q: 0 };
    map.set(name, r);
  }
  r.g += g ?? 0;
  r.q += q ?? 0;
  return r;
}
function rank(map) {
  return [...map.values()].sort(
    (a, b) => b.g - a.g || a.name.localeCompare(b.name),
  );
}
function compact(all, names) {
  const known = all.filter((r) => isKnown(r.name));
  known.forEach((r, i) => (r.rank = i + 1));
  const keep = known.filter((r, i) => i < 5 || names.has(r.name));
  return [
    ...keep,
    {
      name: "其他 Other",
      g: all.reduce((s, r) => s + r.g, 0) - keep.reduce((s, r) => s + r.g, 0),
      q: 0,
    },
  ];
}
export async function summarizeCompetition(chunks, m, isCurrent = () => true) {
  const cur = new Map(),
    prev = new Map(),
    monthly = new Map(),
    yearly = new Map(),
    bands = new Set(m.bands || []),
    plats = new Set(m.plats);
  const priorStart = shift(m.start, -12),
    priorEnd = shift(m.end, -12),
    trendStart = shift(m.end, -23),
    min = Math.min(priorStart, trendStart, m.history ? m.start : m.end);
  let count = 0;
  for (const chunk of chunks)
    for (const [key, rows] of chunk.groups) {
      const [month, p] = key.split("|").map(Number);
      if (month < min || month > m.end || !plats.has(p)) continue;
      for (const r of rows) {
        if (++count % 20000 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (!isCurrent()) return null;
        }
        const name = chunk.labels ? chunk.labels[r[2]] : r[2],
          band = r[3],
          g = r[4],
          q = r[5];
        if (bands.size && !bands.has(band)) continue;
        if (month >= m.start) {
          const v = add(cur, name, g, q);
          v.bands ??= {};
          v.plats ??= {};
          v.bands[band] = (v.bands[band] || 0) + (g || 0);
          v.plats[p] = (v.plats[p] || 0) + (g || 0);
        }
        if (month >= priorStart && month <= priorEnd) add(prev, name, g, q);
        if (month >= trendStart) {
          if (!monthly.has(month)) monthly.set(month, new Map());
          add(monthly.get(month), name, g, q);
        }
        if (m.history && month >= m.start) {
          const year = Math.floor(month / 100);
          if (!yearly.has(year)) yearly.set(year, new Map());
          add(yearly.get(year), name, g, q);
        }
      }
    }
  if (!isCurrent()) return null;
  const all = rank(cur),
    known = all.filter((r) => isKnown(r.name)),
    names = new Set(known.slice(0, 150).map((r) => r.name)),
    topNames = new Set(known.slice(0, 10).map((r) => r.name));
  return {
    cur: compact(all, names).map(({ bands, plats, ...r }) => ({
      ...r,
      platforms: m.plats.map((p) => ({ p, g: plats?.[p] ?? null })),
    })),
    prev: compact(rank(prev), names),
    knownCount: known.length,
    monthly: [...monthly]
      .sort((a, b) => a[0] - b[0])
      .map(([month, map]) => ({ month, ranks: compact(rank(map), topNames) })),
    mainBands: Object.fromEntries(
      known
        .filter((r) => m.allMainBands || names.has(r.name))
        .map((r) => [
          r.name,
          +Object.keys(r.bands).sort(
            (a, b) => r.bands[b] - r.bands[a] || +a - +b,
          )[0],
        ]),
    ),
    yearly: [...yearly].flatMap(([year, map]) =>
      [...map.values()]
        .filter((r) => topNames.has(r.name))
        .map((r) => ({ ...r, name: year + "|" + r.name })),
    ),
  };
}
