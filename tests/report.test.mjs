import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import {
  computeReport,
  bandOpportunity,
  brandEvidence,
} from "../lib/report-model.js";
import { reportNarrative, drawReport, imagePDF } from "../lib/report-render.js";
import { BrowserWorker } from "./worker-shim.mjs";
const cats = [
  { id: "a", path: ["行业", "二级", "增长类目"] },
  { id: "b", path: ["行业", "二级", "平稳类目"] },
];
const filter = {
  ids: ["a", "b"],
  path: ["行业"],
  plats: [0],
  bands: [],
  start: 202501,
  end: 202503,
};
const rows = [];
for (const month of [202501, 202502, 202503])
  for (const [id, b, g, p] of [
    ["a", 0, 150, 100],
    ["a", 1, 80, 40],
    ["b", 0, 500, 500],
  ]) {
    rows.push([id, month, 0, b, g, 10], [id, month - 100, 0, b, p, 8]);
  }
test("one-page opportunity uses matched evidence and relative growth, not CR5 alone", () => {
  const r = computeReport(rows, cats, filter);
  assert.equal(r.total.g, 2190);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].id, "a");
  assert.equal(r.candidates[0].delta, 270);
  const leaf = computeReport(
    rows,
    cats,
    { ...filter, ids: ["a"], path: cats[0].path },
    { ...r.total, label: "所属二级" },
  );
  assert.equal(
    leaf.candidates[0].id,
    "a",
    "leaf compares with parent, not itself",
  );
  assert.equal(bandOpportunity(rows, "a", filter).band, 0);
  assert.equal(
    computeReport(rows, cats, { ...filter, start: 202503 }).candidates.length,
    0,
  );
  const selected = computeReport(rows, cats, { ...filter, bands: [1] });
  assert.equal(selected.total.g, 240);
  assert.equal(selected.selectionShare, 240 / 2190);
  assert.equal(
    selected.candidates.length,
    0,
    "single category cannot outperform itself",
  );
  const missing = rows.filter((r) => r[1] >= 202500);
  assert.equal(computeReport(missing, cats, filter).total.y, null);
  assert.equal(computeReport(missing, cats, filter).candidates.length, 0);
  assert.equal(
    computeReport(rows, cats, { ...filter, plats: [2] }).total.g,
    null,
  );
});
test("brand denominator retains unknown; report and PDF rendering preserve one snapshot", async () => {
  const r = computeReport(rows, cats, filter);
  r.brands = brandEvidence(
    [
      [
        [202501, 0, "甲", 0, 100, 2],
        [202501, 0, "其他 Other", 0, 100, 1],
      ],
    ],
    filter,
  );
  assert.equal(r.brands.cr5, 0.5);
  assert.equal(r.brands.top.length, 1);
  r.candidates[0].price = bandOpportunity(rows, "a", filter);
  r.candidates[0].evidence = r.brands;
  assert.match(reportNarrative(r).headline, /增长类目/);
  const drawn = [];
  const ctx = new Proxy(
    {
      measureText: (s) => ({ width: String(s).length * 20 }),
      fillText: (s, x, y) => drawn.push([s, x, y]),
    },
    { get: (o, k) => o[k] ?? (() => {}) },
  );
  drawReport({ getContext: () => ctx }, r, {
    title: "行业",
    period: "2025-01—2025-03",
    bands: "全部",
    platforms: "天猫",
    last: "2026-09",
    version: "v",
    created: "now",
  });
  assert.ok(drawn.some(([s]) => s.includes("机会类目")));
  assert.ok(drawn.every(([, x, y]) => x >= 0 && x < 1440 && y > 0 && y < 2036));
  const pdf = await imagePDF(
    new Uint8Array([255, 216, 255, 217]),
    1440,
    2036,
  ).text();
  assert.match(pdf, /\/Count 1/);
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
});
test("one-page worker: published scope and two bands agree with original price records", async (t) => {
  const manifest = JSON.parse(fs.readFileSync("data/manifest.json"));
  const industry = JSON.parse(
    zlib.gunzipSync(fs.readFileSync("data/" + manifest.industry)),
  );
  const categories = industry.categories;
  const [key, scope] = Object.entries(manifest.scopes).find(
    ([k, v]) => v.name === "个护仪器",
  );
  assert.ok(manifest.report.prices[key]);
  const f = {
    ...filter,
    ids: scope.ids,
    path: ["个护仪器"],
    end: 202512,
    bands: [6, 7],
    plats: [0, 1, 2],
  };
  const expected = scope.ids.flatMap((id) =>
    JSON.parse(
      zlib.gunzipSync(fs.readFileSync("data/" + manifest.files.price[id])),
    ).map((r) => [id, ...r]),
  );
  const w = new BrowserWorker(
    new URL("../lib/report-worker.js", import.meta.url),
  );
  t.after(() => w.terminate());
  const result = await new Promise((resolve, reject) => {
    w.onmessage = ({ data: m }) =>
      m.error ? reject(Error(m.error)) : resolve(m.result);
    w.onerror = reject;
    w.postMessage({ type: "report", id: 1, manifest, categories, filter: f });
  });
  const direct = computeReport(expected, categories, f);
  assert.equal(result.total.g, direct.total.g);
  assert.equal(result.total.y, direct.total.y);
  assert.deepEqual(
    result.candidates.map((c) => c.id),
    direct.candidates.map((c) => c.id),
  );
  assert.ok(Math.abs(result.total.g - result.brands.total) < 1);
  assert.equal(result.filter.bands.join(","), "6,7");
});
