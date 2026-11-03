import test from "node:test";
import assert from "node:assert/strict";
import { sourceConcentration } from "../lib/metrics.js";
import { JSDOM } from "jsdom";
import {
  paginateTables,
  seriesChart,
  compactTableBody,
} from "../lib/presentation.js";
test("cross-source mismatch preserves explicitly same-source brand shares", () => {
  const c = sourceConcentration(
    [
      { name: "A", g: 40 },
      { name: "B", g: 20 },
      { name: "其他 Other", g: 20 },
    ],
    100,
    false,
  );
  assert.equal(c.coverage, 0.8);
  assert.equal(c.top[0].share, 0.5);
  assert.equal(c.cr5, 0.75);
  assert.equal(c.denominator, 80);
  assert.equal(sourceConcentration([], 100).cr5, null);
});
test("table pagination bounds rows and changes pages locally", () => {
  const dom = new JSDOM(
    '<main><div><table id="x"><tbody>' +
      Array.from({ length: 26 }, (_, i) => `<tr><td>${i}</td></tr>`).join("") +
      "</tbody></table></div></main>",
  );
  const prior = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    paginateTables();
    assert.equal(document.querySelectorAll("tr:not([hidden])").length, 10);
    document.querySelectorAll(".pagination button")[1].click();
    assert.equal(document.querySelector("tr:not([hidden])").textContent, "10");
    const select = document.querySelector("select");
    select.value = "20";
    select.dispatchEvent(new dom.window.Event("change"));
    assert.equal(document.querySelectorAll("tr:not([hidden])").length, 20);
  } finally {
    globalThis.document = prior;
    dom.window.close();
  }
});
test("chart labels are escaped and missing values do not produce NaN", () => {
  const html = seriesChart(
    ["<unsafe>", "b"],
    [{ name: "<brand>", values: [null, 1] }],
    { line: true },
  );
  assert.ok(!html.includes("<unsafe>"));
  assert.ok(!html.includes("NaN"));
  assert.ok(html.includes("&lt;brand&gt;"));
});

test("large tables create DOM for only the requested page", () => {
  const body = Array.from(
    { length: 1000 },
    (_, i) => `<tr><td>${i}</td></tr>`,
  ).join("");
  const dom = new JSDOM(
    '<main><div><table id="large"><tbody>' +
      compactTableBody("large", body) +
      "</tbody></table></div></main>",
  );
  const prior = globalThis.document,
    oldWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    paginateTables();
    assert.equal(document.querySelectorAll("tbody tr").length, 10);
    document.querySelectorAll(".pagination button")[1].click();
    assert.equal(document.querySelector("tbody tr").textContent, "10");
    assert.equal(document.querySelectorAll("tbody tr").length, 10);
  } finally {
    globalThis.document = prior;
    globalThis.window = oldWindow;
    dom.window.close();
  }
});

test("stack labels show cumulative share without normalizing TOP10 to 100%", () => {
  const html = seriesChart(
    ["M"],
    [
      { name: "A", values: [0.3] },
      { name: "B", values: [0.2] },
    ],
    { max: 1, totalLabels: true, format: (v) => (v * 100).toFixed(1) + "%" },
  );
  assert.ok(html.includes("50.0%</text>"));
  assert.ok(html.includes("100.0%</text>"));
  assert.ok(html.includes("stack-total"));
});
