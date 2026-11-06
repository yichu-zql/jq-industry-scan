import { computeReport, brandEvidence } from "./report-model.js";
import { ratio, PRICE } from "./metrics.js";
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
  const bands = current.prices.map((v) => {
    const a = ratio(v.g, current.total.g),
      b = ratio(prior.get(v.band)?.g, old.total.g);
    const brands = brandEvidence(chunks, { ...filter, bands: [v.band] });
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
