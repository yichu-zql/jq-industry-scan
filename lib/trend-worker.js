import { marketTrends, compareBrands } from "./trend-model.js?v=2.6.1";
import { priceSummary } from "./trend-prices.js?v=2.6.1";
const results = new Map();
const cache = new Map(),
  pending = new Map();
let rev = 0,
  industry,
  manifestData;
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  if (pending.has(path)) return pending.get(path);
  const p = (async () => {
    const r = await fetch("../data/" + path);
    if (!r.ok) throw Error("数据加载失败，请重试");
    const b = await r.arrayBuffer(),
      a = new Uint8Array(b);
    const text =
      a[0] === 31 && a[1] === 139
        ? await new Response(
            new Response(b).body.pipeThrough(new DecompressionStream("gzip")),
          ).text()
        : new TextDecoder().decode(b);
    const d = JSON.parse(text);
    cache.set(path, d);
    let size = [...cache.values()].reduce(
      (s, v) => s + (Array.isArray(v) ? v.length : v.rows?.length || 0),
      0,
    );
    while (size > 2500000 && cache.size > 1) {
      const k = cache.keys().next().value,
        v = cache.get(k);
      size -= Array.isArray(v) ? v.length : v.rows?.length || 0;
      cache.delete(k);
    }
    return d;
  })().finally(() => pending.delete(path));
  pending.set(path, p);
  return p;
}
export function brandPaths(m, f) {
  const remaining = new Set(f.ids),
    keys = [];
  for (const [key, s] of Object.entries(m.scopes).sort(
    (a, b) => b[1].ids.length - a[1].ids.length,
  )) {
    if (m.files.brand[key] && s.ids.every((id) => remaining.has(id))) {
      keys.push(key);
      s.ids.forEach((id) => remaining.delete(id));
    }
  }
  keys.push(...remaining);
  const first = (f.endYear - 1) * 100 + 1,
    last = f.endYear * 100 + f.cutoff;
  return keys.flatMap((key) => {
    const p = m.files.brand[key];
    return Array.isArray(p)
      ? p.filter((v) => v.month >= first && v.month <= last).map((v) => v.path)
      : p
        ? [p]
        : [];
  });
}
self.onmessage = async ({ data: m }) => {
  if (m.type === "init") {
    if (industry !== m.industry) results.clear();
    industry = m.industry;
    manifestData = m.manifest;
    return;
  }
  if (m.type === "cancel") {
    rev++;
    return;
  }
  if (m.type !== "generate") return;
  m.manifest ||= manifestData;
  const ticket = ++rev;
  try {
    const key = JSON.stringify([
      m.manifest.version,
      { ...m.filter, name: undefined },
    ]);
    if (results.has(key)) {
      for (const part of results.get(key))
        self.postMessage({ id: m.id, ...part });
      return;
    }
    const market = marketTrends(industry, m.filter);
    self.postMessage({ id: m.id, market });
    const paths = brandPaths(m.manifest, m.filter),
      parts = new Array(paths.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, paths.length) }, async () => {
        while (cursor < paths.length && ticket === rev) {
          const i = cursor++;
          parts[i] = await load(paths[i]);
        }
      }),
    );
    if (ticket !== rev) return;
    const brands = compareBrands(parts, m.filter);
    if (ticket === rev) self.postMessage({ id: m.id, brands });
    const many = async (paths) => {
      const out = new Array(paths.length);
      let n = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, paths.length) }, async () => {
          while (n < paths.length && ticket === rev) {
            const i = n++;
            out[i] = await load(paths[i]);
          }
        }),
      );
      return out;
    };
    const manifest = m.manifest,
      f = m.filter,
      remaining = new Set(f.ids),
      priceTasks = [];
    if (manifest.report?.sourceVersion === manifest.version) {
      for (const [key, path] of Object.entries(manifest.report.prices)) {
        const ids = manifest.scopes[key]?.ids || [];
        if (ids.some((id) => remaining.has(id))) {
          const picked = ids.filter((id) => remaining.has(id));
          picked.forEach((id) => remaining.delete(id));
          priceTasks.push({ path, ids: picked, aggregate: true });
        }
      }
    }
    for (const id of remaining) {
      const p = manifest.files.price[id];
      for (const path of Array.isArray(p) ? p.map((v) => v.path) : p ? [p] : [])
        priceTasks.push({ path, ids: [id] });
    }
    const priceParts = await many(priceTasks.map((v) => v.path));
    if (ticket !== rev) return;
    const rows = priceParts.flatMap((part, i) =>
      priceTasks[i].aggregate
        ? part.filter((r) => priceTasks[i].ids.includes(r[0]))
        : part.map((r) => [priceTasks[i].ids[0], ...r]),
    );
    const left = new Set(f.ids),
      bp = [];
    if (manifest.competitionCubes?.sourceVersion === manifest.version) {
      for (const [key, scope] of Object.entries(manifest.scopes).sort(
        (a, b) => b[1].ids.length - a[1].ids.length,
      )) {
        if (
          manifest.competitionCubes.scopes[key] &&
          scope.ids.every((id) => left.has(id))
        ) {
          bp.push(...Object.values(manifest.competitionCubes.scopes[key]));
          scope.ids.forEach((id) => left.delete(id));
        }
      }
    }
    for (const id of left) {
      const p = manifest.files.brandprice[id];
      bp.push(...(Array.isArray(p) ? p.map((v) => v.path) : p ? [p] : []));
    }
    const chunks = await many(bp);
    if (ticket !== rev) return;
    const prices = priceSummary(rows, chunks, industry.categories, f);
    self.postMessage({ id: m.id, prices });
    results.set(key, [{ market }, { brands }, { prices }]);
    while (results.size > 6) results.delete(results.keys().next().value);
  } catch (e) {
    if (ticket === rev) self.postMessage({ id: m.id, error: e.message });
  }
};
