import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { Worker } from "node:worker_threads";
import {
  prepareCompetitionChunk,
  summarizeCompetition,
} from "../lib/competition-data.js";
import { isKnown, shift } from "../lib/metrics.js";
const read = (p) =>
  JSON.parse(
    p.endsWith(".gz")
      ? zlib.gunzipSync(fs.readFileSync(p))
      : fs.readFileSync(p),
  );
const decode = (d) =>
  Array.isArray(d)
    ? d
    : d.rows.map((r) => [r[0], r[1], d.labels[r[2]], ...r.slice(3)]);
test("competition computes rankings, monthly shares, primary bands and annual data from one scope", async () => {
  const rows = [
    [202501, 0, "a", 0, 80, 8],
    [202501, 0, "b", 0, 70, 7],
    [202501, 0, "b", 1, 70, 7],
    [202501, 0, "c", 2, 900, 9],
    [202501, 0, "其他 Other", 1, 20, 2],
    [202401, 0, "b", 1, 35, 7],
  ];
  const d = await summarizeCompetition([prepareCompetitionChunk(rows)], {
    start: 202501,
    end: 202512,
    plats: [0],
    bands: [0, 1],
    history: true,
  });
  assert.equal(d.cur[0].name, "b");
  assert.equal(d.cur[0].g, 140);
  assert.equal(d.cur[0].q, 14);
  assert.equal(
    d.cur.reduce((s, r) => s + r.g, 0),
    240,
  );
  assert.equal(d.prev.find((r) => r.name === "b").g, 35);
  assert.equal(
    d.monthly
      .find((m) => m.month === 202501)
      .ranks.reduce((s, r) => s + r.g, 0),
    240,
  );
  assert.equal(d.mainBands.b, 0);
  assert.equal(d.yearly.find((r) => r.name === "2025|b").g, 140);
  assert.ok(!d.cur.some((r) => r.name === "c"));
});
test("published competition cubes match original records for multi-band, platform and date selections", async () => {
  const m = read("data/manifest.json");
  assert.equal(m.competitionCubes?.sourceVersion, m.version);
  const [key, scope] = Object.entries(m.scopes).find(
    ([, s]) => s.name === "个护仪器",
  );
  const raw = scope.ids.flatMap((id) =>
    decode(read("data/" + m.files.brandprice[id])),
  );
  const cube = m.competitionCubes.scopes[key];
  const chunks = Object.fromEntries(
    Object.entries(cube).map(([b, p]) => [
      b,
      prepareCompetitionChunk(read("data/" + p)),
    ]),
  );
  for (const [start, end, bands, plats] of [
    [202501, 202512, [6, 7], [0, 1, 2]],
    [202609, 202609, [0], [0]],
    [202401, 202609, [0, 8], [1, 2]],
  ]) {
    const d = await summarizeCompetition(
      bands.map((b) => chunks[b]).filter(Boolean),
      { start, end, bands, plats, history: true },
    );
    const selected = raw.filter(
        (r) =>
          r[0] >= start &&
          r[0] <= end &&
          bands.includes(r[3]) &&
          plats.includes(r[1]),
      ),
      map = new Map();
    for (const [, p, n, b, g, q] of selected) {
      const v = map.get(n) || { g: 0, q: 0, bands: {}, plats: {} };
      v.g += g || 0;
      v.q += q || 0;
      v.bands[b] = (v.bands[b] || 0) + (g || 0);
      v.plats[p] = (v.plats[p] || 0) + (g || 0);
      map.set(n, v);
    }
    const ranked = [...map]
      .filter(([n]) => isKnown(n))
      .sort((a, b) => b[1].g - a[1].g || a[0].localeCompare(b[0]));
    assert.deepEqual(
      d.cur
        .filter((r) => isKnown(r.name))
        .slice(0, 100)
        .map((r) => r.name),
      ranked.slice(0, 100).map(([n]) => n),
    );
    assert.ok(
      Math.abs(
        d.cur.reduce((s, r) => s + r.g, 0) -
          [...map.values()].reduce((s, r) => s + r.g, 0),
      ) < 0.05,
    );
    for (const r of d.cur.filter((r) => isKnown(r.name)).slice(0, 100)) {
      assert.ok(Math.abs(r.g - map.get(r.name).g) < 0.05);
      assert.ok(Math.abs(r.q - map.get(r.name).q) < 0.05);
      const best = +Object.keys(map.get(r.name).bands).sort(
        (a, b) =>
          map.get(r.name).bands[b] - map.get(r.name).bands[a] || +a - +b,
      )[0];
      assert.equal(d.mainBands[r.name], best);
    }
    for (const month of d.monthly) {
      const total = raw
        .filter(
          (r) =>
            r[0] === month.month &&
            bands.includes(r[3]) &&
            plats.includes(r[1]),
        )
        .reduce((s, r) => s + (r[4] || 0), 0);
      assert.ok(
        Math.abs(month.ranks.reduce((s, r) => s + r.g, 0) - total) < 0.05,
      );
    }
  }
});
test("rapid worker requests share downloads; only newest selection returns and repeat uses cache", async () => {
  const url = new URL("../lib/competition-worker.js", import.meta.url).href;
  const wrapper = `const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);globalThis.fetch=async url=>{parentPort.postMessage({fetch:url});await new Promise(r=>setTimeout(r,40));return new Response(JSON.stringify([[202501,0,'brand',url==='a'?0:1,url==='a'?10:20,1]]));};import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`;
  const worker = new Worker(wrapper, { eval: true }),
    messages = [],
    waiters = new Map();
  worker.on("message", (m) => {
    messages.push(m);
    if (m.ready) waiters.get("ready")?.(m);
    if (m.result || m.error) waiters.get(m.id)?.(m);
  });
  try {
    await new Promise((resolve) => waiters.set("ready", resolve));
    const request = {
      type: "competition",
      files: [{ url: "a" }, { url: "b" }],
      start: 202501,
      end: 202512,
      plats: [0],
    };
    worker.postMessage({ ...request, id: 1, bands: [0] });
    await new Promise((r) => setTimeout(r, 10));
    const second = new Promise((resolve) => waiters.set(2, resolve));
    worker.postMessage({ ...request, id: 2, bands: [0, 1] });
    assert.equal((await second).result.cur[0].g, 30);
    const third = new Promise((resolve) => waiters.set(3, resolve));
    worker.postMessage({ ...request, id: 3, bands: [0, 1] });
    assert.equal((await third).result.cur[0].g, 30);
    assert.equal(messages.filter((m) => m.fetch === "a").length, 1);
    assert.equal(messages.filter((m) => m.fetch === "b").length, 1);
    assert.ok(!messages.some((m) => m.id === 1 && m.result));
  } finally {
    await worker.terminate();
  }
});
