import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import zlib from "node:zlib";
import { BrowserWorker } from "./worker-shim.mjs";
test("real snapshot: hierarchy, matrix, date, category and all six page paths", async (t) => {
  if (!fs.existsSync("data/manifest.json")) return;
  const dom = new JSDOM(fs.readFileSync("index.html", "utf8"), {
    url: "http://localhost/#overview",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    location: dom.window.location,
  });
  const workers = [];
  t.after(async () => {
    for (const w of workers) await w.terminate();
    delete globalThis.Worker;
    dom.window.close();
  });
  globalThis.Worker = class extends BrowserWorker {
    constructor(...a) {
      super(...a);
      workers.push(this);
    }
  };
  dom.window.scrollTo = () => {};
  globalThis.fetch = async (url) => {
    const p = String(url).split("?")[0].replace(/^\.\//, "");
    if (!fs.existsSync(p)) return new Response("Not found", { status: 404 });
    return new Response(fs.readFileSync(p));
  };
  await import("../app.js?test=" + Date.now());
  const wait = async (predicate) => {
    for (let i = 0; i < 1500; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error(
      "UI condition timed out: " +
        document.querySelector("#main").textContent.slice(0, 250),
    );
  };
  await wait(() => document.querySelector("#growth-table"));
  assert.equal(document.querySelectorAll(".matrix button").length, 24);
  assert.ok(
    document
      .querySelector("#industry-table tbody tr td:nth-child(4)")
      .textContent.includes("%"),
    "observed share remains available when coverage is incomplete",
  );
  assert.ok(
    document
      .querySelector("#industry-table tbody tr td:nth-child(3)")
      .textContent.includes("%"),
    "comparable YoY is explicitly available",
  );
  assert.ok(document.querySelectorAll(".databar .fill").length > 0);
  const first = document.querySelector("[data-expand]");
  first.click();
  await wait(() => document.querySelector(".depth1"));
  const cells = [...document.querySelectorAll("[data-matrix]")];
  const filled = cells.find(
    (b) => Number(b.querySelector("b").textContent) > 0,
  );
  assert.ok(filled);
  filled.click();
  await wait(() => document.querySelector("[data-matrix][aria-pressed=true]"));
  assert.ok(document.querySelector("#growth-table tbody tr"));
  const reset = document.querySelector('[data-action="clear-matrix"]');
  reset.click();
  // Whole-industry common periods use the compact exact summaries.
  document.querySelector('[data-view="competition"]').click();
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelector("#main").dataset.view === "competition",
  );
  assert.ok(document.querySelector("#competition-table tbody tr"));
  t.diagnostic(
    "Whole-industry competition render, local files: " +
      document.querySelector("#main").dataset.renderMs +
      " ms",
  );
  document.querySelector('[data-view="overview"]').click();
  await wait(
    () =>
      document.querySelector("#growth-table") &&
      document.querySelector("#main").getAttribute("aria-busy") === "false",
  );
  // Select one actual category through the same picker used by the user.
  document.querySelector("#category-button").click();
  document.querySelector("#cat-clear").click();
  const category = document.querySelector("[data-cat]");
  const branch = category.closest("details");
  branch.open = true;
  const branchKey = branch.dataset.node;
  category.checked = true;
  category.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.ok(
    [...document.querySelectorAll("#category-tree details")].find(
      (e) => e.dataset.node === branchKey,
    )?.open,
    "selection preserves expanded category",
  );
  document.querySelector("#cat-done").click();
  await wait(() =>
    document.querySelector("#category-button").textContent.includes("1 个"),
  );
  for (const view of ["market", "price", "competition", "brand", "method"]) {
    document.querySelector(`[data-view="${view}"]`).click();
    await wait(
      () =>
        document.querySelector("#main").getAttribute("aria-busy") === "false" &&
        document.querySelector("#main").dataset.view === view,
    );
    assert.ok(
      !document.querySelector("#main").textContent.includes("加载未完成"),
      view + " rendered",
    );
  }
  document.querySelector('[data-view="market"]').click();
  const mode = document.querySelector("#mode");
  mode.value = "month";
  mode.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(
    document.querySelector("#start").value,
    document.querySelector("#end").value,
  );
  // Rapid changes must leave only the final scope visible, including cancelled worker jobs.
  for (const view of ["competition", "brand", "price", "market"])
    document.querySelector(`[data-view="${view}"]`).click();
  const platform = document.querySelector('[data-plat="2"]');
  platform.checked = false;
  platform.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelector("#main").dataset.view === "market",
  );
  assert.ok(
    !document.querySelector("#main").textContent.includes("请求已取消"),
  );
  assert.ok(!document.querySelector("#range").textContent.includes("抖音"));
  mode.value = "custom";
  mode.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(document.querySelector("#start").disabled, false);
  // Category changes must update the active analysis without a separate Done click.
  document.querySelector("#reset").click();
  document.querySelector('[data-view="competition"]').click();
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelector("#competition-table"),
  );
  const before = document.querySelector("#competition-table").textContent;
  document.querySelector("#category-button").click();
  const chooseRoot = (name) => {
    const input = [...document.querySelectorAll("[data-path]")].find(
      (e) => e.dataset.path === JSON.stringify([name]),
    );
    input.checked = true;
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  chooseRoot("护肤");
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelector("#competition-table")?.textContent !== before,
  );
  let state = JSON.parse(localStorage.getItem("jq-scan-v2")).state;
  const manifest = JSON.parse(fs.readFileSync("data/manifest.json"));
  const industry = JSON.parse(
    zlib.gunzipSync(fs.readFileSync("data/" + manifest.industry)),
  );
  const cats = industry.categories;
  assert.equal(
    new Set(state.cats.map((id) => cats.find((c) => c.id === id).path[0])).size,
    1,
  );
  document.querySelector('[data-view="price"]').click();
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelector("#price-brand-table"),
  );
  const priceBefore = document.querySelector("#price-brand-table").textContent;
  chooseRoot("个护仪器");
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelector("#price-brand-table")?.textContent !== priceBefore,
  );
  assert.equal(
    document.querySelectorAll('[data-action="clear-price"]').length,
    0,
  );
  document.querySelector("#cat-done").click();
  document.querySelector('[data-view="overview"]').click();
  document.querySelector("#reset").click();
  await wait(
    () =>
      document.querySelector("#main").getAttribute("aria-busy") === "false" &&
      document.querySelectorAll("[data-overview-root]").length > 1,
  );
  const rootInput = document.querySelector("[data-overview-root]");
  const excluded = rootInput.dataset.overviewRoot;
  rootInput.checked = false;
  rootInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await wait(
    () => document.querySelector("#main").getAttribute("aria-busy") === "false",
  );
  assert.equal(
    document.querySelectorAll("#industry-table tbody tr").length,
    13,
  );
  assert.equal(
    JSON.parse(localStorage.getItem("jq-scan-v2")).state.cats,
    null,
    "overview filter does not mutate global categories",
  );
  assert.ok(
    ![...document.querySelectorAll("#industry-table [data-expand]")].some((e) =>
      e.textContent.includes(excluded),
    ),
  );
});
