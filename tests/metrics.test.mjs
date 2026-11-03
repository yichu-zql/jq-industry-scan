import test from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  scale,
  months,
  shift,
  aggregate,
  pairedAggregate,
  indexIndustry,
  concentration,
  annualRange,
  csv,
} from "../lib/metrics.js";
test("four exclusive growth groups and >50% eligibility", () => {
  assert.equal(classify([100, 90, 80, 70]).group, 0);
  assert.equal(classify([100, 160, 120, 130]).group, 1);
  assert.equal(classify([100, 160, 120, 130]).eligibleHistory, true);
  assert.equal(classify([100, 150, 120, 130]).eligibleHistory, false);
  assert.equal(classify([100, 150.000000001, 120, 130]).eligibleHistory, true);
  assert.equal(classify([100, 110, 120, 130]).group, 2);
  assert.equal(classify([100, 120, 144, 172.8]).group, 3);
  assert.equal(classify([100, 0, 120, 130]).group, null);
  assert.equal(classify([100, null, 120, 130]).group, null);
  assert.equal(classify([100, 100, 100, 100]).group, 1);
});
test("scale lower inclusive upper exclusive", () => {
  assert.equal(scale(99999999), null);
  assert.equal(scale(1e8), 0);
  assert.equal(scale(5e8), 1);
  assert.equal(scale(1e10), 5);
});
test("calendar and three YoY require four full years", () => {
  assert.equal(shift(202601, -1), 202512);
  assert.equal(months(202510, 202609).length, 12);
  assert.deepEqual(annualRange(202609), [2022, 2023, 2024, 2025]);
  assert.deepEqual(annualRange(202612), [2023, 2024, 2025, 2026]);
});
test("missing rows are not zero and platform totals stay scoped", () => {
  const i = indexIndustry([
    ["a", 202601, 0, 100, 10],
    ["a", 202602, 0, 120, 12],
  ]);
  assert.equal(aggregate(i, ["a"], [0], 202601, 202602).complete, true);
  assert.equal(aggregate(i, ["a"], [0, 1], 202601, 202602).complete, false);
  assert.equal(aggregate(i, ["a"], [0], 202601, 202603).g, 220);
});
test("CR5 excludes other from rank but preserves denominator and reconciles", () => {
  const r = [
    { name: "其他 Other", g: 40 },
    { name: "A", g: 60 },
  ];
  assert.equal(concentration(r, 100).cr5, 0.6);
  assert.equal(concentration(r, 200).cr5, null);
  assert.equal(concentration(r, 200).top[0].name, "A");
  assert.equal(concentration(r, 200).top[0].share, null);
});
test("CSV neutralizes spreadsheet formulas", () => {
  assert.match(csv([["=1+1", "商品"]]), /"'=1\+1"/);
});

test("comparable growth excludes unmatched records without turning them into zero", () => {
  const i = indexIndustry([
    ["a", 202501, 0, 100, 10],
    ["a", 202601, 0, 120, 10],
    ["b", 202601, 0, 900, 90],
  ]);
  const c = pairedAggregate(i, ["a", "b"], [0], 202601, 202601);
  assert.equal(c.pairs, 1);
  assert.equal(c.cur.g, 120);
  assert.equal(c.prev.g, 100);
  assert.equal(aggregate(i, ["a", "b"], [0], 202501, 202501).complete, false);
  assert.equal(aggregate(i, ["a", "b"], [0], 202501, 202501).qtyValid, true);
  assert.equal(pairedAggregate(i, ["b"], [0], 202601, 202601).cur.g, null);
});
