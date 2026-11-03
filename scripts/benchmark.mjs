import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { BrowserWorker } from "../tests/worker-shim.mjs";
const m = JSON.parse(fs.readFileSync("data/manifest.json"));
const w = new BrowserWorker(
  new URL("../lib/analysis-worker.js", import.meta.url),
);
const files = m.files.brand.scope_all
  .filter((x) => x.month >= 202410 && x.month <= 202609)
  .map((x) => ({ id: "scope_all", url: "http://localhost/data/" + x.path }));
let seq = 0,
  pending = new Map(),
  last = performance.now(),
  maxLag = 0;
const timer = setInterval(() => {
  const now = performance.now();
  maxLag = Math.max(maxLag, now - last - 20);
  last = now;
}, 20);
w.onmessage = ({ data: d }) => {
  if (d.result || d.error) {
    const p = pending.get(d.id);
    if (p) {
      pending.delete(d.id);
      d.error ? p.reject(Error(d.error)) : p.resolve(d.result);
    }
  }
};
w.onerror = (e) => {
  for (const p of pending.values()) p.reject(e);
};
const run = async (plats) => {
  const id = ++seq,
    start = performance.now();
  const result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({
      type: "analyze",
      id,
      kind: "brand",
      files,
      start: 202510,
      end: 202609,
      plats,
    });
  });
  return {
    ms: Math.round(performance.now() - start),
    brands: result.cur.length,
  };
};
try {
  const cold = await run([0, 1, 2]),
    platform = await run([0]),
    warm = await run([0, 1, 2]);
  console.log(
    JSON.stringify(
      {
        environment:
          "Node worker_threads, local disk, no network/browser rendering",
        compressedMB:
          files.reduce(
            (s, x) =>
              s + fs.statSync(x.url.replace("http://localhost/", "")).size,
            0,
          ) / 1e6,
        cold,
        platform,
        warm,
        mainHeartbeatMaxDelayMs: Math.round(maxLag),
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(timer);
  await w.terminate();
}
