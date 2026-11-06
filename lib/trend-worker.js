import { marketTrends, compareBrands } from "./trend-model.js?v=2.4.0";
const cache = new Map(),
  pending = new Map();
let rev = 0,
  industry;
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
    industry = m.industry;
    return;
  }
  if (m.type === "cancel") {
    rev++;
    return;
  }
  if (m.type !== "generate") return;
  const ticket = ++rev;
  try {
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
  } catch (e) {
    if (ticket === rev) self.postMessage({ id: m.id, error: e.message });
  }
};
