import { indexIndustry, categoryMetrics } from "./metrics.js";
let index;
self.onmessage = (event) => {
  const m = event.data;
  if (m.type === "init") {
    index = indexIndustry(m.rows);
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
