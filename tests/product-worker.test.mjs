import test from "node:test";
import assert from "node:assert/strict";
import { BrowserWorker } from "./worker-shim.mjs";
import { parseTagRule } from "../lib/trend-rules.js";
for (const catalog of ["product-catalog.json", "product-catalog-compact.json"])
  test("worker uses exact SKU hits from " + catalog, async (t) => {
    const w = new BrowserWorker(
      new URL("../lib/trend-worker.js", import.meta.url),
    );
    t.after(() => w.terminate());
    const manifest = {
      version: "fixture",
      products: { catalog: "../tests/fixtures/" + catalog },
    };
    const industry = {
      categories: [{ id: "a", path: ["护肤", "面部护理", "面部精华"] }],
      rows: [["a", 202501, 0, 999999, 99]],
    };
    w.postMessage({ type: "init", industry, manifest });
    const f = {
      ids: ["a"],
      plats: [0],
      startYear: 2024,
      endYear: 2025,
      cutoff: 1,
      rule: parseTagRule("包含次抛精华，不包含水光"),
    };
    const run = (id) =>
      new Promise((resolve, reject) => {
        let m, b;
        w.onerror = reject;
        w.onmessage = ({ data: r }) => {
          if (r.error) reject(Error(r.error));
          if (r.market) m = r.market;
          if (r.brands) b = r.brands;
          if (r.prices) resolve({ m, b, p: r.prices });
        };
        w.postMessage({ type: "generate", id, filter: f });
      });
    const a = await run(1);
    assert.equal(a.m.kpi.g, 200);
    assert.equal(a.b.total, 200);
    assert.equal(a.p.total.g, 200);
    assert.equal(a.m.productInfo.products, 1);
    assert.equal(a.m.productInfo.oldTop[0].g, 100);
    const b = await run(2);
    assert.deepEqual(b, a);
  });
