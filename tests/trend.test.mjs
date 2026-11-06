import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import {
  marketTrends,
  compareBrands,
  number,
  percent,
} from "../lib/trend-model.js";
import { chartSVG, rawRows } from "../lib/trend-chart.js";
import { editableWorkbook } from "../lib/trend-export.js";
import { BrowserWorker } from "./worker-shim.mjs";
const industry = {
  categories: [
    { id: "a", path: ["行业一", "二级", "A"] },
    { id: "b", path: ["行业二", "二级", "B"] },
  ],
  rows: [
    ["a", 202301, 0, 100, 1],
    ["a", 202401, 0, 120, 1],
    ["a", 202501, 0, 160, 1],
    ["b", 202401, 0, 80, 1],
    ["b", 202501, 0, 90, 1],
    ["a", 202412, 0, 500, 1],
  ],
};
const f = {
  ids: ["a", "b", "a"],
  plats: [0],
  startYear: 2023,
  endYear: 2025,
  cutoff: 1,
  depth: 3,
  top: 1,
};
test("trend totals deduplicate mixed roots; growth pairs same months and other reconciles", () => {
  const r = marketTrends(industry, f);
  assert.deepEqual(r.channels.totals, [100, 700, 250]);
  assert.equal(r.channels.growth[0], null);
  assert.equal(r.channels.growth[2], 0.25);
  assert.equal(r.categories.series.at(-1).name, "其他");
  for (let i = 0; i < 3; i++)
    assert.equal(
      r.categories.series.reduce((s, v) => s + (v.values[i] || 0), 0),
      r.channels.totals[i],
    );
  assert.equal(r.count, 2);
  assert.equal(percent(0.012345), "1.23%");
  assert.equal(number(12345678), "1234.57万");
  const raw = rawRows(r.channels);
  assert.equal(typeof raw[3].at(-1), "number");
  assert.ok(!chartSVG(r.channels).includes("NaN"));
});
test("TOP5 reranks each period independently and unknown stays in denominator", () => {
  const b = compareBrands(
    [
      [
        [202401, 0, "A", 100, 1],
        [202401, 0, "B", 80, 1],
        [202501, 0, "B", 200, 1],
        [202501, 0, "其他 Other", 100, 1],
      ],
    ],
    f,
  );
  assert.equal(b.oldTop[0].name, "A");
  assert.equal(b.top[0].name, "B");
  assert.equal(b.cr5, 2 / 3);
  assert.equal(b.highlights[0].y, 1.5);
  assert.equal(b.highlights[0].gain.delta, 120);
});
test("editable XLSX contains native dual-axis charts, numeric sources and formula references", async () => {
  const model = marketTrends(industry, f).channels,
    blob = editableWorkbook({ model, metadata: [["来源", "行业表"]] });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /<c:barChart>/);
  assert.match(text, /<c:lineChart>/);
  assert.match(text, /c:axId val="40"/);
  assert.match(text, /sourceLinked="0"/);
  assert.match(text, /<f>.*原始数据/);
  assert.match(text, /horizontal="center"/);
  assert.ok(!text.includes("xl/media"));
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync("outputs/trend-chart-test.xlsx", bytes);
});
test("trend worker real snapshot returns market and brand stages for exact scope", async (t) => {
  const manifest = JSON.parse(fs.readFileSync("data/manifest.json"));
  const data = JSON.parse(
    zlib.gunzipSync(fs.readFileSync("data/" + manifest.industry)),
  );
  const id = data.categories.find((c) => c.path[2] === "吹风机").id;
  const filter = {
    ...f,
    ids: [id],
    plats: [0, 1, 2],
    endYear: 2026,
    cutoff: 9,
  };
  const w = new BrowserWorker(
    new URL("../lib/trend-worker.js", import.meta.url),
  );
  t.after(() => w.terminate());
  const stages = [];
  await new Promise((resolve, reject) => {
    w.onmessage = ({ data: m }) => {
      if (m.error) return reject(Error(m.error));
      stages.push(m);
      if (m.brands) resolve();
    };
    w.onerror = reject;
    w.postMessage({ type: "init", industry: data });
    w.postMessage({ type: "generate", id: 1, manifest, filter });
  });
  assert.equal(stages.length, 2);
  assert.deepEqual(
    stages[0].market.channels.totals,
    marketTrends(data, filter).channels.totals,
  );
  assert.equal(stages[1].brands.start, 202601);
  assert.equal(stages[1].brands.oldEnd, 202509);
});
