import {
  indexIndustry,
  categoryMetrics,
  aggregate,
  pairedAggregate,
  yoy,
  ratio,
  shift,
} from "./metrics.js";
let index;
self.onmessage = (event) => {
  const m = event.data;
  if (m.type === "init") {
    index = indexIndustry(m.rows);
    return;
  }
  if (m.type === "distribution") {
    try {
      const rows = m.groups.map((ids) => {
        const a = aggregate(index, ids, m.plats, m.start, m.end),
          b = aggregate(
            index,
            ids,
            m.plats,
            shift(m.start, -12),
            shift(m.end, -12),
          );
        const c = pairedAggregate(index, ids, m.plats, m.start, m.end);
        return {
          g: a.g,
          y: yoy(c.cur.g, c.prev.g),
          coverageCur: ratio(c.cur.g, a.g),
          coveragePrev: ratio(c.prev.g, b.g),
        };
      });
      self.postMessage({ id: m.id, rows });
    } catch (e) {
      self.postMessage({ id: m.id, error: e.message });
    }
    return;
  }
  if (m.type === "compute") {
    try {
      const rows = m.ids.map((id) =>
        categoryMetrics(index, id, m.plats, m.start, m.end),
      );
      self.postMessage({ id: m.id, rows });
    } catch (e) {
      self.postMessage({ id: m.id, error: e.message });
    }
  }
};
