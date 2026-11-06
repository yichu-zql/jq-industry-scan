import { createProductAggregation } from "./trend-products.js?v=2.7.0";
import { marketTrends, compareBrands } from "./trend-model.js?v=2.7.0";
import { priceSummary } from "./trend-prices.js?v=2.7.0";
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
    const r = await fetch(
      path.startsWith("https://") ? path : "../data/" + path,
    );
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
    while (size > 400000 && cache.size > 1) {
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
async function productStages(m, ticket) {
  const catalog = await load(
    (m.manifest.products?.catalog || "products.json") +
      "?v=" +
      (m.manifest.products?.assetCommit || m.manifest.version),
  );
  if (catalog.sourceVersion !== m.manifest.version)
    throw Error("商品数据版本不一致，请刷新后重试");
  if (!m.filter.rule?.text && catalog.leaders) {
    const f = m.filter,
      remaining = new Set(f.ids),
      keys = [];
    for (const [key, scope] of Object.entries(m.manifest.scopes || {}).sort(
      (a, b) => b[1].ids.length - a[1].ids.length,
    )) {
      if (catalog.leaders[key] && scope.ids.every((id) => remaining.has(id))) {
        keys.push(key);
        scope.ids.forEach((id) => remaining.delete(id));
      }
    }
    keys.push(...remaining);
    const mask = f.plats.reduce((s, p) => s | (1 << p), 0),
      parts = [];
    let n = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, keys.length) }, async () => {
        while (n < keys.length && ticket === rev) {
          const key = keys[n++];
          if (catalog.leaders[key])
            parts.push(await load(catalog.base + catalog.leaders[key].path));
        }
      }),
    );
    if (ticket !== rev) return;
    const merged = (month) => {
      const points = parts.map((d) => d.points[month]?.[mask]).filter(Boolean);
      const total = points.reduce((s, p) => s + p.total, 0),
        products = points.reduce((s, p) => s + p.products, 0);
      const top = points
        .flatMap((p) => p.top)
        .sort(
          (a, b) =>
            b.g - a.g ||
            (a.category + "|" + a.p + "|" + (a.id || a.name) <
            b.category + "|" + b.p + "|" + (b.id || b.name)
              ? -1
              : 1),
        )
        .slice(0, 10)
        .map((v) => ({ ...v, share: total > 0 ? v.g / total : null }));
      return { top, total, products };
    };
    const a = merged(f.endYear * 100 + f.cutoff),
      b = merged((f.endYear - 1) * 100 + f.cutoff);
    return [
      {
        market: {
          productInfo: {
            ...a,
            oldTop: b.top,
            oldTotal: b.total,
            rule: "全部商品",
          },
        },
      },
    ];
  }
  const f = m.filter,
    lo =
      (f.rule?.text
        ? Math.min(f.startYear - 1, f.endYear - 1)
        : f.endYear - 1) *
        100 +
      1,
    hi = f.endYear * 100 + f.cutoff;
  const tasks = f.ids.flatMap((id) =>
    (catalog.files[id] || [])
      .filter((v) => (v.last ?? v.month) >= lo && (v.first ?? v.month) <= hi)
      .map((v) => ({ ...v, id })),
  );
  if (!tasks.length) throw Error("所选范围暂无商品明细");
  const agg = createProductAggregation(industry.categories, f);
  let cursor = 0,
    done = 0,
    lastProgress = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (cursor < tasks.length && ticket === rev) {
        const t = tasks[cursor++];
        const data = await load(catalog.base + t.path);
        if (ticket !== rev) return;
        if (data.schema === 3) {
          const months = new Map();
          for (const r of data.rows) {
            if (r[0] < lo || r[0] > hi) continue;
            const item = data.items[r[2]];
            if (!months.has(r[0])) months.set(r[0], []);
            months.get(r[0]).push([r[1], ...item, r[3], r[4], r[5]]);
          }
          for (const [month, rows] of months) agg.add(t.id, month, rows);
        } else agg.add(t.id, t.month, data);
        done++;
        if (done === tasks.length || Date.now() - lastProgress > 120) {
          lastProgress = Date.now();
          self.postMessage({
            id: m.id,
            progress: `正在筛选商品 ${done}/${tasks.length}`,
          });
        }
      }
    }),
  );
  if (ticket !== rev) return;
  const stages = agg.finish();
  return stages;
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
      m.manifest.products?.assetCommit,
      { ...m.filter, name: undefined },
    ]);
    if (results.has(key)) {
      for (const part of results.get(key))
        self.postMessage({ id: m.id, ...part });
      return;
    }
    if (typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname)) {
      self.postMessage({id:m.id, progress:"正在查询本机分析库（首次使用会准备所选类目数据）…"});
      const response = await fetch("/api/products", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(m.filter)});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "本机查询失败");
      if (ticket !== rev) return;
      const agg = createProductAggregation(industry.categories,m.filter);
      for (const [id,month,p] of data.coverage) agg.observe(id,month,p);
      const groups = new Map();
      for (const [id,month,...row] of data.rows) {
        const key=JSON.stringify([id,month]);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(row);
      }
      for (const [key,rows] of groups) agg.add(...JSON.parse(key),rows);
      const stages=agg.finish();
      stages[0].market.productInfo.scanned=data.coverage.reduce((s,r)=>s+r[3],0);
      stages[0].market.productInfo.sourceUpdated=data.sourceUpdated;
      stages[0].market.productInfo.queryVersion=data.version;
      stages[0].market.productInfo.unavailableCategories=data.unavailableCategories || [];
      for (const stage of stages) self.postMessage({id:m.id,...stage});
      return;
    }
    if (m.filter.rule?.text) {
      const stages = await productStages(m, ticket);
      if (!stages) return;
      for (const stage of stages) self.postMessage({ id: m.id, ...stage });
      results.set(key, stages);
      while (results.size > 6) results.delete(results.keys().next().value);
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
    const stages = [{ market }, { brands }, { prices }];
    if (m.manifest.products) {
      const itemStages = await productStages(
        {
          ...m,
          filter: { ...m.filter, startYear: m.filter.endYear - 1, rule: null },
        },
        ticket,
      );
      if (!itemStages || ticket !== rev) return;
      const products = itemStages[0].market.productInfo;
      self.postMessage({ id: m.id, products });
      stages.push({ products });
    }
    results.set(key, stages);
    while (results.size > 6) results.delete(results.keys().next().value);
  } catch (e) {
    if (ticket === rev) self.postMessage({ id: m.id, error: e.message });
  }
};
