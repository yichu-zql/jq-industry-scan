import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { BrowserWorker } from "./worker-shim.mjs";

test("brand-oriented files preserve category, platform, period and price totals", async (t) => {
  const m = JSON.parse(fs.readFileSync("data/manifest.json"));
  assert.ok(m.brandDetails, "Brand drilldown acceleration must be packaged");
  const name = Object.keys(m.brandDetails.brand).find((n) =>
    n.includes("philips"),
  );
  assert.ok(name);
  const read = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync("data/" + p)));
  const rows = read(m.brandDetails.brand[name]);
  const ids = [...new Set(rows.map((r) => r[5]))].slice(0, 3);
  const worker = new BrowserWorker(
    new URL("../lib/analysis-worker.js", import.meta.url),
  );
  t.after(() => worker.terminate());
  let id = 0;
  const run = (job) =>
    new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.error) reject(Error(data.error));
        else if (data.result) resolve(data.result);
      };
      worker.onerror = reject;
      worker.postMessage({
        type: "analyze",
        id: ++id,
        start: 202601,
        end: 202609,
        plats: [0, 2],
        brand: name,
        history: true,
        ...job,
      });
    });
  const url = (p) => "http://localhost/data/" + p;
  for (const kind of ["brand", "price"]) {
    const source = kind === "brand" ? "brand" : "brandprice";
    const raw = await run({
      kind,
      brandOnly: kind === "brand",
      files: ids.map((id) => ({ id, url: url(m.files[source][id]) })),
    });
    const fast = await run({
      kind,
      brandOnly: kind === "brand",
      selectedCategories: ids,
      files: [{ id: "brand-detail", url: url(m.brandDetails[source][name]) }],
    });
    const sum = (r) => r.reduce((s, x) => s + x.g, 0);
    assert.ok(
      Math.abs(
        sum(kind === "brand" ? raw.cur : raw.bins) -
          sum(kind === "brand" ? fast.cur : fast.bins),
      ) < 0.01,
      kind + " amount",
    );
    if (kind === "brand") {
      for (const r of raw.byCategory) {
        const f = fast.byCategory.find((x) => x.id === r.id);
        assert.ok(f);
        for (const k of ["g", "q"]) assert.ok(Math.abs(r[k] - f[k]) < 0.01, k);
      }
      assert.deepEqual(fast.monthlyPlatforms, raw.monthlyPlatforms);
    } else
      for (const r of raw.bins) {
        const f = fast.bins.find((x) => x.name === r.name);
        assert.ok(Math.abs(r.g - f.g) < 0.01);
        assert.ok(Math.abs(r.q - f.q) < 0.01);
      }
  }
});
