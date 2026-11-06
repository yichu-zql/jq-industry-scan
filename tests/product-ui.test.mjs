import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { createProductAggregation } from "../lib/trend-products.js";
import { parseTagRule } from "../lib/trend-rules.js";
test("tagged report renders matching TOP10, legends, themes and numeric export", async (t) => {
  const dom = new JSDOM('<main id="main"></main>', {
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
  });
  const category = { id: "a", path: ["护肤", "面部护理", "面部精华"] };
  let calls = 0,
    blob;
  const original = URL.createObjectURL;
  URL.createObjectURL = (b) => {
    blob = b;
    return "blob:test";
  };
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  globalThis.Worker = class {
    postMessage(m) {
      if (m.type !== "generate") return;
      calls++;
      const agg = createProductAggregation([category], m.filter);
      for (const month of [202401, 202501])
        agg.add(
          "a",
          month,
          JSON.parse(fs.readFileSync(`tests/fixtures/products-${month}.json`)),
        );
      queueMicrotask(() => {
        for (const s of agg.finish())
          this.onmessage({ data: { id: m.id, ...s } });
      });
    }
    terminate() {}
  };
  t.after(() => {
    URL.createObjectURL = original;
    delete globalThis.Worker;
    dom.window.close();
  });
  const { mountTrends, cancelTrends } = await import("../lib/trend-view.js");
  mountTrends({
    element: document.querySelector("main"),
    industry: { categories: [category], rows: [] },
    manifest: {
      first: 202201,
      last: 202501,
      version: "fixture",
      products: { assetCommit: "fixture" },
    },
    ids: ["a"],
    plats: [0],
    isCurrent: () => true,
  });
  const textarea = document.querySelector("#tag-rules textarea");
  textarea.value = "包含次抛精华，不包含水光";
  textarea.dispatchEvent(new dom.window.Event("input"));
  document.querySelector("#tag-confirm").click();
  document.querySelector("#trend-generate").click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(document.querySelector("#trend-status").dataset.ready, "true");
  assert.equal(document.querySelector("#trend-start").value, "2023");
  assert.match(
    document.querySelector("#trend-products").textContent,
    /TOP10商品/,
  );
  assert.equal(document.querySelectorAll("#trend-products tbody tr").length, 2);
  assert.equal(
    document.querySelectorAll("#trend-competition .platform-legend").length,
    2,
  );
  document
    .querySelector('[data-trend-download="products"][data-format="csv"]')
    .click();
  const text = await blob.text();
  assert.match(text, /200/);
  assert.doesNotMatch(text.split("\r\n\r\n")[1], /水光/);
  const theme = document.querySelector("#trend-theme");
  theme.value = "dashboard";
  theme.dispatchEvent(new dom.window.Event("change"));
  assert.equal(calls, 1);
  assert.ok(document.querySelector("#trend-products"));
  assert.equal(document.querySelector("#trend-print").disabled, false);
  cancelTrends();
});
