import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { JSDOM } from "jsdom";
import { BrowserWorker } from "./worker-shim.mjs";
test("report dialog keeps controls responsive, invalidates export, closes and regenerates", async (t) => {
  const dom = new JSDOM('<button id="one-page-open">一页纸概览</button>', {
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });
  // jsdom does not implement native dialog methods; emulate only this browser contract.
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  const workers = [];
  globalThis.Worker = class extends BrowserWorker {
    constructor(...a) {
      super(...a);
      workers.push(this);
    }
  };
  const ctx = new Proxy(
    {
      measureText: (s) => ({ width: String(s).length * 20 }),
      fillText: () => {},
    },
    { get: (o, k) => o[k] ?? (() => {}) },
  );
  dom.window.HTMLCanvasElement.prototype.getContext = () => ctx;
  t.after(async () => {
    for (const w of workers) await w.terminate();
    delete globalThis.Worker;
    dom.window.close();
  });
  const wait = async (predicate) => {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error("report wait timeout");
  };
  const manifest = JSON.parse(fs.readFileSync("data/manifest.json"));
  const categories = JSON.parse(
    zlib.gunzipSync(fs.readFileSync("data/" + manifest.industry)),
  ).categories;
  const id = categories.find((c) => c.path[0] === "个护仪器").id;
  const { openBrief } = await import("../lib/report-view.js");
  const context = {
    manifest,
    categories,
    ids: [id],
    start: 202501,
    end: 202512,
    plats: [0, 1, 2],
  };
  openBrief(context);
  const $ = (id) => document.getElementById(id);
  assert.equal($("brief-dialog").open, true);
  $("brief-generate").click();
  await wait(() => $("brief-status").dataset.ready === "true");
  assert.equal($("brief-pdf").disabled, false);
  assert.ok($("brief-preview").querySelector("canvas"));
  const checkbox = document.querySelector('[data-brief-band][value="6"]');
  checkbox.checked = true;
  checkbox.dispatchEvent(new dom.window.Event("change"));
  assert.equal($("brief-pdf").disabled, true);
  assert.equal($("brief-generate").disabled, false);
  $("brief-generate").click();
  $("brief-close").click();
  assert.equal($("brief-dialog").open, false);
  openBrief(context);
  assert.equal(
    $("brief-generate").disabled,
    false,
    "closing active request does not strand generate button",
  );
  $("brief-generate").click();
  await wait(() => $("brief-status").dataset.ready === "true");
  assert.equal($("brief-pdf").disabled, false);
  $("brief-period").value = "year:2024";
  $("brief-period").dispatchEvent(new dom.window.Event("change"));
  assert.equal($("brief-start").value, "2024-01");
  assert.equal($("brief-end").value, "2024-12");
  assert.equal($("brief-pdf").disabled, true);
  $("brief-close").click();
});
