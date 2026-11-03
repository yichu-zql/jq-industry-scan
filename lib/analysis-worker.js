import { brandRank, isKnown, shift } from "./metrics.js";
const cache = new Map(),
  resultCache = new Map();
let currentController;
function decode(d) {
  if (Array.isArray(d)) return d;
  for (const r of d.rows) r[2] = d.labels[r[2]];
  return d.rows;
}
async function get(url, signal) {
  if (cache.has(url)) {
    const value = cache.get(url);
    cache.delete(url);
    cache.set(url, value);
    return value;
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error("数据请求失败 " + response.status);
  const bytes = await response.arrayBuffer(),
    head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const text =
    head[0] === 31 && head[1] === 139
      ? await new Response(
          new Response(bytes).body.pipeThrough(new DecompressionStream("gzip")),
        ).text()
      : new TextDecoder().decode(bytes);
  const rows = decode(JSON.parse(text));
  cache.set(url, rows);
  let size = 0;
  for (const value of cache.values()) size += value.length;
  while (size > 3500000 && cache.size > 1) {
    const key = cache.keys().next().value;
    size -= cache.get(key).length;
    cache.delete(key);
  }
  return rows;
}
function plus(map, name, g, q) {
  let a = map.get(name);
  if (!a) {
    a = { name, g: 0, q: 0 };
    map.set(name, a);
  }
  a.g += g || 0;
  a.q += q || 0;
}
function rank(map) {
  return [...map.values()].sort((a, b) => b.g - a.g);
}
function compactRanks(all, names = null, search = "", selected = "") {
  const known = all.filter((r) => isKnown(r.name));
  known.forEach((r, i) => (r.rank = i + 1));
  const selectedNames =
    names ||
    new Set(
      [
        ...known.slice(0, 150),
        ...known
          .filter((r) => search && r.name.includes(search.toLowerCase()))
          .slice(0, 150),
        ...known.filter((r) => r.name === selected),
      ].map((r) => r.name),
    );
  const keep = known.filter((r, i) => i < 5 || selectedNames.has(r.name));
  const kept = keep.reduce((s, r) => s + r.g, 0),
    total = all.reduce((s, r) => s + r.g, 0);
  return [...keep, { name: "其他 Other", g: total - kept, q: 0 }];
}
function topSummary(map) {
  const all = rank(map),
    total = all.reduce((s, r) => s + r.g, 0),
    top = all.filter((r) => isKnown(r.name)).slice(0, 5);
  return [
    ...top,
    {
      name: "其他 Other",
      g: Math.max(0, total - top.reduce((s, r) => s + r.g, 0)),
      q: 0,
    },
  ];
}
self.onmessage = async ({ data: m }) => {
  if (m.type === "cancel") {
    currentController?.abort();
    return;
  }
  if (m.type !== "analyze") return;
  currentController?.abort();
  const controller = new AbortController();
  currentController = controller;
  const resultKey = JSON.stringify({ ...m, id: undefined });
  if (resultCache.has(resultKey)) {
    const result = resultCache.get(resultKey);
    resultCache.delete(resultKey);
    resultCache.set(resultKey, result);
    self.postMessage({ id: m.id, result });
    return;
  }
  const yearly = new Map(),
    yearSame = new Map(),
    yearlyNames = new Set(m.yearlyNames || []);
  const cur = new Map(),
    prev = new Map(),
    monthly = new Map(),
    bins = new Map(),
    byCategory = [],
    byPlatform = new Map();
  const priorStart = shift(m.start, -12),
    priorEnd = shift(m.end, -12),
    trendStart = shift(m.end, -23);
  let pos = 0;
  try {
    const pending = new Map();
    const prefetch = (i) => {
      if (i < m.files.length) {
        const p = get(m.files[i].url, controller.signal);
        p.catch(() => {});
        pending.set(i, p);
      }
    };
    for (let i = 0; i < Math.min(6, m.files.length); i++) prefetch(i);
    for (let fileIndex = 0; fileIndex < m.files.length; fileIndex++) {
      const f = m.files[fileIndex];
      if (controller.signal.aborted) return;
      const rows = await pending.get(fileIndex);
      pending.delete(fileIndex);
      prefetch(fileIndex + 6);
      let catg = 0,
        catq = 0,
        catTotal = 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        if (rowIndex % 50000 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (controller.signal.aborted) return;
        }
        const r = rows[rowIndex];
        if (!m.plats.includes(r[1])) continue;
        if (m.kind === "brand") {
          const [month, p, name, g, q] = r;
          if (
            month <= m.end &&
            ((m.brandOnly && name === m.brand) || yearlyNames.has(name))
          ) {
            const year = Math.floor(month / 100),
              key = year + "|" + name;
            plus(yearly, key, g, q);
            if (month % 100 <= m.end % 100) plus(yearSame, key, g, q);
          }
          if (month >= m.start && month <= m.end) catTotal += g || 0;
          if (m.brandOnly && name !== m.brand) continue;
          if (month >= m.start && month <= m.end) {
            plus(cur, name, g, q);
            if (name === m.brand) {
              catg += g || 0;
              catq += q || 0;
              plus(byPlatform, p, g, q);
            }
          }
          if (month >= priorStart && month <= priorEnd) plus(prev, name, g, q);
          if (month >= trendStart && month <= m.end) {
            if (!monthly.has(month)) monthly.set(month, new Map());
            plus(monthly.get(month), name, g, q);
          }
        } else {
          const [month, p, name, band, g, q] = r;
          if (
            month < m.start ||
            month > m.end ||
            (m.brand && name !== m.brand) ||
            (m.band != null && band !== m.band)
          )
            continue;
          plus(bins, band, g, q);
          let b = cur.get(name);
          if (!b) {
            b = { name, g: 0, q: 0, bands: {} };
            cur.set(name, b);
          }
          b.g += g || 0;
          b.q += q || 0;
          b.bands[band] = (b.bands[band] || 0) + (g || 0);
        }
      }
      if (m.brand && catg > 0)
        byCategory.push({ id: f.id, g: catg, q: catq, sourceTotal: catTotal });
      pos++;
      self.postMessage({ id: m.id, progress: pos, total: m.files.length });
    }
    if (controller.signal.aborted) return;
    const rankings = rank(cur),
      knownCount = rankings.filter((r) => isKnown(r.name)).length;
    const compact =
      m.kind === "brand"
        ? compactRanks(rankings, null, m.search, m.brand)
        : null;
    const result =
      m.kind === "brand"
        ? {
            cur: compact,
            knownCount,
            prev: compactRanks(rank(prev), new Set(compact.map((r) => r.name))),
            monthly: [...monthly].map(([month, map]) => ({
              month,
              ranks: topSummary(map),
              brand: m.brand ? map.get(m.brand) : null,
            })),
            byCategory,
            byPlatform: rank(byPlatform),
            yearly: [...yearly.values()],
            yearSame: [...yearSame.values()],
          }
        : {
            top: rankings.filter((r) => isKnown(r.name)).slice(0, 20),
            bins: rank(bins),
          };
    resultCache.set(resultKey, result);
    while (resultCache.size > 3)
      resultCache.delete(resultCache.keys().next().value);
    self.postMessage({ id: m.id, result });
  } catch (e) {
    if (!controller.signal.aborted)
      self.postMessage({ id: m.id, error: e.message });
  }
};
