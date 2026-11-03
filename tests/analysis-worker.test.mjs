import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import zlib from "node:zlib";
import { brandRank, isKnown } from "../lib/metrics.js";
test("background brand aggregation agrees with direct calculation", async (t) => {
  const m = fs.existsSync("data/manifest.json")
    ? JSON.parse(fs.readFileSync("data/manifest.json"))
    : null;
  const file = Object.entries(m?.files?.brand || {}).find(
    ([id]) => !id.startsWith("scope_"),
  );
  if (!file) {
    t.skip("Brand snapshot not packaged yet");
    return;
  }
  const [id, filename] = file,
    path = "data/" + filename;
  let data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path)));
  if (!Array.isArray(data)) {
    for (const r of data.rows) r[2] = data.labels[r[2]];
    data = data.rows;
  }
  const workerUrl = new URL("../lib/analysis-worker.js", import.meta.url).href;
  const wrapper = `const {parentPort}=require('node:worker_threads');const fs=require('node:fs');globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);globalThis.fetch=async url=>new Response(fs.readFileSync(new URL(url)));import(${JSON.stringify(workerUrl)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`;
  const w = new Worker(wrapper, { eval: true });
  try {
    const result = await new Promise((resolve, reject) => {
      w.on("error", reject);
      w.on("message", (m) => {
        if (m.ready)
          w.postMessage({
            type: "analyze",
            id: 1,
            kind: "brand",
            files: [{ id, url: new URL("../" + path, import.meta.url).href }],
            start: 202510,
            end: 202609,
            plats: [0, 1, 2],
          });
        else if (m.error) reject(Error(m.error));
        else if (m.result) resolve(m.result);
      });
    });
    const expected = brandRank(data, [0, 1, 2], 202510, 202609);
    assert.equal(
      result.knownCount,
      expected.filter((r) => isKnown(r.name)).length,
    );
    assert.equal(result.cur[0]?.name, expected[0]?.name);
    assert.ok(
      Math.abs(
        result.cur.reduce((a, r) => a + r.g, 0) -
          expected.reduce((a, r) => a + r.g, 0),
      ) < 0.01,
    );
  } finally {
    await w.terminate();
  }
});
