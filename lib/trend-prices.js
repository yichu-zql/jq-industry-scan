import { computeReport } from "./report-model.js";
import { ratio, PRICE, isKnown } from "./metrics.js";
// Price rows retain leaf IDs; aggregate scopes must never widen the selection.
export function priceSummary(rows, chunks, categories, f) {
  const filter = {
    ids: [...new Set(f.ids)],
    plats: f.plats,
    bands: [],
    start: f.endYear * 100 + 1,
    end: f.endYear * 100 + f.cutoff,
  };
  const current = computeReport(rows, categories, filter);
  const old = computeReport(rows, categories, {
    ...filter,
    start: filter.start - 100,
    end: filter.end - 100,
  });
  const prior = new Map(old.prices.map((v) => [v.band, v]));
  // Scan brand-price records once, not once per displayed price band.
  const byBand = new Map();
  for (const d of chunks)
    for (const r of Array.isArray(d) ? d : d.rows) {
      if (
        r[0] < filter.start ||
        r[0] > filter.end ||
        !filter.plats.includes(r[1]) ||
        !Number.isFinite(r[4])
      )
        continue;
      if (!byBand.has(r[3])) byBand.set(r[3], { total: 0, map: new Map() });
      const b = byBand.get(r[3]);
      b.total += r[4];
      const name = Array.isArray(d) ? r[2] : d.labels[r[2]];
      if (isKnown(name)) b.map.set(name, (b.map.get(name) || 0) + r[4]);
    }
  const bands = current.prices.map((v) => {
    const a = ratio(v.g, current.total.g),
      b = ratio(prior.get(v.band)?.g, old.total.g);
    const bucket = byBand.get(v.band),
      total = bucket?.total ?? 0;
    const rank = [...(bucket?.map || [])]
      .map(([name, g]) => ({ name, g, share: ratio(g, total) }))
      .sort((a, b) => b.g - a.g || a.name.localeCompare(b.name));
    const brands = {
      total,
      top: rank.slice(0, 5),
      cr5: rank.length
        ? ratio(
            rank.slice(0, 5).reduce((s, v) => s + v.g, 0),
            total,
          )
        : null,
      identified: ratio(
        rank.reduce((s, v) => s + v.g, 0),
        total,
      ),
    };
    return {
      ...v,
      name: v.band < 0 ? "价格未分类" : PRICE[v.band] + "元",
      share: a,
      change: a !== null && b !== null ? a - b : null,
      brands,
    };
  });
  return { bands, total: current.total, previous: old.total };
}
