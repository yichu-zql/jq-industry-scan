import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { JSDOM } from "jsdom";
import { distributionAccumulator, seaColor } from "../lib/distribution.js";
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
  assert.match(seaColor(0.3), /^hsl\(2 /);
  assert.match(seaColor(0.2999), /^hsl\(214 /);
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
  host.querySelector("#bubble-min").value = "90";
  host.querySelector("#bubble-max").value = "20";
  host.querySelector("#bubble-apply").click();
  assert.match(
    host.querySelector("#bubble-status").textContent,
    /下限不能大于上限/,
  );
  dom.window.close();
});
