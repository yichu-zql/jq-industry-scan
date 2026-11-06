import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { BrowserWorker } from "./worker-shim.mjs";
test("trend UI local filters, stale export guard, editable downloads and remount", async (t) => {
  const dom = new JSDOM('<main id="main"></main>', {
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });
  const workers = [];
  globalThis.Worker = class extends BrowserWorker {
    constructor(...a) {
      super(...a);
      workers.push(this);
    }
  };
  let downloads = [];
  const original = URL.createObjectURL;
  URL.createObjectURL = (b) => {
    downloads.push(b);
    return "blob:test";
  };
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  t.after(async () => {
    for (const w of workers) await w.terminate();
    URL.createObjectURL = original;
    delete globalThis.Worker;
    dom.window.close();
  });
  const wait = async (predicate) => {
    for (let i = 0; i < 500; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error("Timed out");
  };
  const manifest = JSON.parse(fs.readFileSync("data/manifest.json")),
    industry = JSON.parse(
      zlib.gunzipSync(fs.readFileSync("data/" + manifest.industry)),
    ),
    id = industry.categories.find((c) => c.path[2] === "吹风机").id;
  const { mountTrends, cancelTrends } = await import("../lib/trend-view.js");
  const ctx = {
    element: document.getElementById("main"),
    manifest,
    industry,
    ids: [id],
    plats: [0, 1, 2],
    isCurrent: () => true,
  };
  mountTrends(ctx);
  assert.equal(document.querySelectorAll("[data-applied-remove]").length, 1);
  document.getElementById("selection-edit").click();
  assert.ok(document.querySelectorAll("#selection-options input").length<=60);
  document.getElementById("selection-clear").click();
  document.getElementById("selection-cancel").click();
  assert.equal(
    document.querySelectorAll("[data-applied-remove]").length,
    1,
    "cancel keeps applied scope",
  );
  const industryName = document.getElementById("industry-name");
  industryName.value = "吹风机研究";
  industryName.dispatchEvent(new dom.window.Event("input"));
  document.getElementById("scheme-save").click();
  assert.match(
    window.localStorage.getItem("jq-custom-industries-v1"),
    /吹风机研究/,
  );
  document.getElementById("trend-generate").click();
  await wait(
    () => document.getElementById("trend-status").dataset.ready === "true",
  );
  assert.equal(document.querySelectorAll(".trend-svg svg").length, 1);
  assert.equal(
    document.querySelectorAll(".trend-competition tbody tr").length,
    6,
  );
  document
    .querySelector('[data-trend-download="channels"][data-format="xlsx"]')
    .click();
  assert.match(await downloads.at(-1).text(), /<c:lineChart>/);
  assert.ok(document.querySelector("#trend-prices tbody tr"));
  const mode = document.getElementById("price-mode");
  mode.value = "share";
  mode.dispatchEvent(new dom.window.Event("change"));
  document
    .querySelector('[data-trend-download="prices"][data-format="csv"]')
    .click();
  assert.match(await downloads.at(-1).text(), /带内品牌份额/);
  assert.match(await downloads.at(-1).text(), /品牌GMV/);
  assert.ok(
    !document.querySelector("#trend-prices").textContent.includes("NaN"),
  );
  document
    .querySelector('[data-trend-download="competition"][data-format="xlsx"]')
    .click();
  assert.match(await downloads.at(-1).text(), /平台|天猫/);
  const end = document.getElementById("trend-end");
  end.value = "2025";
  end.dispatchEvent(new dom.window.Event("change"));
  assert.equal(document.querySelector("[data-trend-download]").disabled, true);
  document.getElementById("trend-generate").click();
  await wait(
    () => document.getElementById("trend-status").dataset.ready === "true",
  );
  document
    .querySelector('[data-trend-download="channels"][data-format="csv"]')
    .click();
  assert.match(await downloads.at(-1).text(), /2025年1—9月/);
  assert.ok(!document.querySelector(".trend-svg").textContent.includes("NaN"));
  cancelTrends();
  mountTrends(ctx);
  document.getElementById("trend-generate").click();
  await wait(
    () => document.getElementById("trend-status").dataset.ready === "true",
  );
  const before = downloads.length;
  document
    .querySelector('[data-trend-download="channels"][data-format="svg"]')
    .click();
  assert.equal(
    downloads.length,
    before + 1,
    "remount does not duplicate export handlers",
  );
  assert.equal(document.getElementById('tag-description'),null);
  assert.match(document.getElementById('tag-rules').textContent,/GitHub版/);

  cancelTrends();
});
