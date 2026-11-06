import test from "node:test";
import assert from "node:assert/strict";
import { priceSummary } from "../lib/trend-prices.js";
import { normalizeScheme } from "../lib/trend-selection.js";
import { BrowserWorker } from "./worker-shim.mjs";
import fs from "node:fs";
import zlib from "node:zlib";
const cats = [
  { id: "a", path: ["A", "a", "one"] },
  { id: "b", path: ["B", "b", "two"] },
  { id: "c", path: ["C", "c", "excluded"] },
];
test("custom industry pricing uses exact leaf scope, paired growth and band brand denominators", () => {
  const f = { ids: ["a", "a", "b"], plats: [0], endYear: 2025, cutoff: 1 };
  const rows = [
    ["a", 202401, 0, 0, 100, 10],
    ["a", 202501, 0, 0, 150, 15],
    ["b", 202401, 0, 1, 100, 5],
    ["b", 202501, 0, 1, 50, 2],
    ["c", 202501, 0, 0, 999, 99],
  ];
  const chunks = [
    [
      [202501, 0, "Brand", 0, 60, 2],
      [202501, 0, "其他 Other", 0, 40, 2],
      [202501, 0, "Second", 1, 50, 1],
    ],
  ];
  const p = priceSummary(rows, chunks, cats, f);
  assert.equal(p.total.g, 200);
  assert.equal(p.total.y, 0);
  assert.equal(p.bands[0].share, 0.75);
  assert.equal(p.bands[0].change, 0.25);
  assert.equal(p.bands[0].y, 0.5);
  assert.equal(p.bands[0].brands.top[0].share, 0.6);
  assert.equal(
    p.bands.reduce((s, v) => s + v.g, 0),
    p.total.g,
  );
  assert.deepEqual(
    normalizeScheme(
      { version: 1, name: " study ", ids: ["a", "a", "b"] },
      cats,
    ),
    { version: 1, name: "study", ids: ["a", "b"] },
  );
  assert.throws(() =>
    normalizeScheme({ version: 1, name: "x", ids: ["missing"] }, cats),
  );
});
test("real custom worker prices and cached stages stay in selected cross-root scope", async (t) => {
  const manifest = JSON.parse(fs.readFileSync("data/manifest.json"));
  const industry = JSON.parse(
    zlib.gunzipSync(fs.readFileSync("data/" + manifest.industry)),
  );
  const a = industry.categories.find((c) => c.path[2] === "吹风机");
  const b = industry.categories.find(
    (c) => c.path[0] !== a.path[0] && manifest.files.brandprice[c.id],
  );
  const filter = {
    ids: [a.id, b.id],
    plats: [0, 1, 2],
    startYear: 2024,
    endYear: 2026,
    cutoff: 9,
  };
  const w = new BrowserWorker(
    new URL("../lib/trend-worker.js", import.meta.url),
  );
  t.after(() => w.terminate());
  w.postMessage({ type: "init", industry });
  const run = (id) =>
    new Promise((resolve, reject) => {
      const out = [];
      w.onmessage = ({ data: m }) => {
        if (m.error) reject(Error(m.error));
        out.push(m);
        if (m.prices) resolve(out);
      };
      w.onerror = reject;
      w.postMessage({ type: "generate", id, manifest, filter });
    });
  const out = await run(1);
  assert.equal(out.length, 3);
  assert.equal(out[0].market.count, 2);
  const priceRows = [];
  for (const id of filter.ids) {
    const path = manifest.files.price[id];
    const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync("data/" + path)));
    for (const r of rows)
      if (r[0] >= 202601 && r[0] <= 202609 && Number.isFinite(r[3]))
        priceRows.push(r);
  }
  const expected = priceRows.reduce((s, r) => s + r[3], 0);
  assert.ok(
    Math.abs(out[2].prices.total.g - expected) < Math.max(1, expected * 1e-10),
  );
  const cached = await run(2);
  assert.deepEqual(cached[2].prices, out[2].prices);
});
