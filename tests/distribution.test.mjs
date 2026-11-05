import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { JSDOM } from "jsdom";
import {
  distributionAccumulator,
  seaColor,
  inCr5Range,
} from "../lib/distribution.js";
import { mountDistribution } from "../lib/bubble-view.js";

test("distribution pools brands before CR5; missing prior is null; boundary is red", () => {
  const a = distributionAccumulator(202501, 202512);
  for (let i = 0; i < 8; i++) {
    a.add("group", 202501, "brand" + i, 10, 1);
    a.add("group", 202401, "brand" + i, 5, 1);
  }
  a.add("group", 202501, "其他 Other", 20, 1);
  a.add("new", 202501, "a", 10, 1);
  const [r, n] = a.result();
  assert.equal(r.g, 100);
  assert.equal(r.cr5, 0.5);
  assert.equal(r.y, 1.5);
  assert.equal(n.y, null);
  assert.equal(seaColor(0.3), "rgb(255 207 198)");
  assert.equal(seaColor(0), "rgb(8 55 156)");
  assert.equal(seaColor(1), "rgb(151 0 24)");
  assert.notEqual(seaColor(0.05), seaColor(0.25));
  assert.notEqual(seaColor(0.4), seaColor(0.8));
  assert.equal(seaColor(null), "#9299a5");
});

test("multi-band worker ranks combined actual sales and preserves unknown denominator and prior", async () => {
  const rows = [
    [202501, 0, "a", 0, 80, 8],
    [202501, 0, "b", 0, 70, 7],
    [202501, 0, "b", 1, 70, 7],
    [202501, 0, "c", 2, 900, 9],
    [202501, 0, "其他 Other", 1, 20, 2],
    [202401, 0, "b", 1, 35, 7],
  ];
  const url = new URL("../lib/analysis-worker.js", import.meta.url).href;
  const wrapper = `const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=m=>parentPort.postMessage(m);globalThis.fetch=async()=>new Response(JSON.stringify(${JSON.stringify(rows)}));import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`;
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
            bands: [0, 1],
            files: [{ id: "x", url: "http://fixture" }],
            start: 202501,
            end: 202512,
            plats: [0],
          });
        else if (m.error) reject(Error(m.error));
        else if (m.result) resolve(m.result);
      });
    });
    assert.equal(result.cur[0].name, "b");
    assert.equal(result.cur[0].g, 140);
    assert.equal(result.cur[0].q, 14);
    assert.equal(
      result.cur.reduce((s, r) => s + r.g, 0),
      240,
    );
    assert.equal(result.prev.find((r) => r.name === "b").g, 35);
    assert.ok(!result.cur.some((r) => r.name === "c"));
  } finally {
    await w.terminate();
  }
});

test("bubble drill path, CR5 controls, missing growth and brand gray", async () => {
  const dom = new JSDOM('<div id="host"></div>');
  const host = dom.window.document.querySelector("#host");
  mountDistribution(host, {
    categories: [{ id: "a", path: ["一级", "二级", "三级"] }],
    end: 202512,
    plats: [0],
    esc: String,
    money: String,
    pct: String,
    isCurrent: () => true,
    aggregate: () => ({ g: 100, y: 0.2 }),
    request: async (groups, price) =>
      price
        ? [
            {
              key: 0,
              g: 100,
              y: 0.1,
              cr5: 0.5,
              top: [{ name: "品牌", g: 80, y: 0.2 }],
            },
          ]
        : groups.map((g, i) => ({ key: i, cr5: 0.2 })),
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await tick();
  assert.equal(host.querySelectorAll("svg [data-point]").length, 1);
  host.querySelector('[data-sea="red"]').click();
  assert.equal(host.querySelectorAll("svg [data-point]").length, 0);
  host.querySelector('[data-sea="all"]').click();
  for (let i = 0; i < 4; i++) {
    host
      .querySelector("[data-point]")
      .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await tick();
  }
  assert.match(host.textContent, /TOP5品牌/);
  assert.equal(host.querySelector("circle").getAttribute("fill"), "#9299a5");
  host.querySelector('[data-back="2"]').click();
  await tick();
  assert.match(host.textContent, /三级/);
  assert.ok(host.querySelector("svg [data-point]"));
  const select = host.querySelector("#bubble-range");
  select.value = "low";
  select.dispatchEvent(new dom.window.Event("change"));
  assert.equal(host.querySelectorAll("svg [data-point]").length, 0);
  assert.equal(host.querySelectorAll("input[type=number]").length, 0);
  dom.window.close();
});

test("fixed CR5 ranges partition exact boundaries and exclude missing values", () => {
  for (const [v, expected] of [
    [0, "low"],
    [0.1, "low"],
    [0.10001, "mid"],
    [0.29999, "mid"],
    [0.3, "high"],
    [0.49999, "high"],
    [0.5, "top"],
    [1, "top"],
  ]) {
    assert.deepEqual(
      ["low", "mid", "high", "top"].filter((k) => inCr5Range(v, k)),
      [expected],
    );
  }
  assert.equal(inCr5Range(null, "all"), true);
  assert.equal(inCr5Range(null, "low"), false);
});

test("large bubble views render in batches, cancel stale drawing and paginate details", async () => {
  const dom = new JSDOM('<div id="host"></div>'),
    host = dom.window.document.querySelector("#host");
  let calls = 0;
  mountDistribution(host, {
    categories: Array.from({ length: 420 }, (_, i) => ({
      id: String(i),
      path: ["类目" + i, "二级", "三级"],
    })),
    end: 202512,
    plats: [0],
    esc: String,
    money: String,
    pct: String,
    isCurrent: () => true,
    aggregateGroups: async (groups) =>
      groups.map((g, i) => ({ g: i + 1, y: 0.2 })),
    request: async (groups) => {
      calls++;
      return groups.map((g, i) => ({ key: i, cr5: 0.2 }));
    },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await tick();
  assert.equal(host.querySelectorAll("tbody").length, 0);
  const select = host.querySelector("#bubble-range");
  select.value = "low";
  select.dispatchEvent(new dom.window.Event("change"));
  await tick();
  assert.equal(
    host.querySelectorAll("circle").length,
    0,
    "stale batch cannot reinsert filtered circles",
  );
  const all = host.querySelector("#bubble-range");
  all.value = "all";
  all.dispatchEvent(new dom.window.Event("change"));
  for (let i = 0; i < 20 && host.dataset.rendering !== "false"; i++)
    await tick();
  assert.equal(host.querySelectorAll("circle").length, 420);
  assert.equal(calls, 1, "filter uses cached data");
  host.querySelector("details").open = true;
  await tick();
  await tick();
  assert.equal(host.querySelectorAll("tbody tr").length, 50);
  host.querySelector('[data-detail-page="1"]').click();
  assert.equal(host.querySelectorAll("tbody tr").length, 50);
  dom.window.close();
});
