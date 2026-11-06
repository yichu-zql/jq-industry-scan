import {
  computeReport,
  bandOpportunity,
  brandEvidence,
} from "./report-model.js?v=2.7.0";
const cache = new Map(),
  pending = new Map(),
  results = new Map();
let revision = 0;
async function load(path) {
  if (cache.has(path)) return cache.get(path);
  if (pending.has(path)) return pending.get(path);
  const promise = (async () => {
    const r = await fetch("../data/" + path);
    if (!r.ok) throw Error("数据加载失败，请重试");
    const buf = await r.arrayBuffer();
    const head = new Uint8Array(buf);
    const text =
      head[0] === 31 && head[1] === 139
        ? await new Response(
            new Response(buf).body.pipeThrough(new DecompressionStream("gzip")),
          ).text()
        : new TextDecoder().decode(buf);
    const d = JSON.parse(text);
    cache.set(path, d);
    while (cache.size > 25) cache.delete(cache.keys().next().value);
    return d;
  })().finally(() => pending.delete(path));
  pending.set(path, promise);
  return promise;
}
async function many(paths, current = () => true) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, paths.length) }, async () => {
      while (i < paths.length && current()) {
        const n = i++;
        out[n] = await load(paths[n]);
      }
    }),
  );
  return out;
}
const paths = (v) => (Array.isArray(v) ? v.map((r) => r.path) : v ? [v] : []);
self.onmessage = async ({ data: m }) => {
  if (m.type === "cancel") {
    revision++;
    return;
  }
  if (m.type !== "report") return;
  const run = ++revision,
    key = JSON.stringify([m.manifest.version, m.filter]);
  try {
    if (results.has(key)) {
      self.postMessage({ id: m.id, result: results.get(key) });
      return;
    }
    const { manifest, filter, categories } = m;
    const scope = Object.entries(manifest.scopes).find(
      ([k, v]) =>
        k !== "scope_all" && filter.ids.every((id) => v.ids.includes(id)),
    );
    let rows;
    if (scope && manifest.report?.sourceVersion === manifest.version)
      rows = await load(manifest.report.prices[scope[0]]);
    else {
      const parts = await many(
        filter.ids.flatMap((id) => paths(manifest.files.price[id])),
      );
      rows = parts.flatMap((p, i) => p.map((r) => [filter.ids[i], ...r]));
    }
    if (run !== revision) return;
    let benchmark = null;
    if (
      filter.ids.length === 1 &&
      scope &&
      manifest.report?.sourceVersion === manifest.version
    ) {
      const leaf = categories.find((c) => c.id === filter.ids[0]);
      const peers = categories
        .filter((c) => c.path[0] === leaf.path[0] && c.path[1] === leaf.path[1])
        .map((c) => c.id);
      const peer = computeReport(rows, categories, {
        ...filter,
        ids: peers,
        path: leaf.path.slice(0, 2),
      });
      benchmark = { ...peer.total, label: "所属二级「" + leaf.path[1] + "」" };
    }
    const result = computeReport(rows, categories, filter, benchmark);
    const whole =
      scope &&
      scope[1].ids.length === filter.ids.length &&
      manifest.competitionCubes?.sourceVersion === manifest.version;
    const brandPaths = whole
      ? Object.entries(manifest.competitionCubes.scopes[scope[0]])
          .filter(([b]) => !filter.bands.length || filter.bands.includes(+b))
          .map(([, p]) => p)
      : filter.ids.flatMap((id) => paths(manifest.files.brandprice[id]));
    const brandData = await many(brandPaths, () => run === revision);
    if (run !== revision) return;
    result.brands = brandEvidence(brandData, filter);
    for (const c of result.candidates) {
      c.price = bandOpportunity(rows, c.id, filter);
      if (c.price) {
        c.evidence = brandEvidence(
          await many(paths(manifest.files.brandprice[c.id])),
          { ...filter, bands: [c.price.band] },
        );
      }
      if (run !== revision) return;
    }
    results.set(key, result);
    while (results.size > 8) results.delete(results.keys().next().value);
    self.postMessage({ id: m.id, result });
  } catch (e) {
    if (run === revision) self.postMessage({ id: m.id, error: e.message });
  }
};
