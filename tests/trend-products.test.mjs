import test from "node:test";
import assert from "node:assert/strict";
import {
  createProductAggregation,
  productMatches,
} from "../lib/trend-products.js";
import { parseTagRule } from "../lib/trend-rules.js";
const cats = [{ id: "a", path: ["护肤", "面部护理", "面部精华"] }];
const f = {
  ids: ["a"],
  plats: [0],
  startYear: 2024,
  endYear: 2025,
  cutoff: 1,
  rule: parseTagRule("包含次抛精华，不包含水光"),
};
test("product tagging filters actual names and all report modules use the same hits", () => {
  assert.equal(productMatches("水光次抛精华", f.rule), false);
  assert.equal(productMatches("修护次抛精华", f.rule), true);
  const a = createProductAggregation(cats, f);
  a.add("a", 202401, [
    [0, "1", "修护次抛精华", "A", 100, 100, 1],
    [0, "2", "水光次抛精华", "B", 200, 900, 5],
  ]);
  a.add("a", 202501, [
    ["tmall", "1", "修护次抛精华", "A", 100, 200, 2],
    [0, "2", "水光次抛精华", "B", 200, 1000, 5],
    [1, "3", "次抛精华", "C", 300, 500, 2],
    [0, "4", "普通面霜", "D", 100, 500, 5],
  ]);
  const [m, b, p] = a.finish();
  assert.equal(m.market.kpi.g, 200);
  assert.equal(m.market.kpi.y, 1);
  assert.equal(b.brands.top[0].g, 200);
  assert.equal(b.brands.cr5, 1);
  assert.equal(p.prices.total.g, 200);
  assert.equal(m.market.productInfo.products, 1);
  assert.equal(m.market.productInfo.top[0].name, "修护次抛精华");
});
test("no keyword hits stays empty instead of falling back to entire category", () => {
  const a = createProductAggregation(cats, f);
  a.add("a", 202501, [[0, "x", "水光次抛精华", "X", 100, 999, 1]]);
  const [m, b, p] = a.finish();
  assert.equal(m.market.kpi.g, 0);
  assert.equal(m.market.productInfo.products, 0);
  assert.equal(b.brands.top.length, 0);
  assert.equal(p.prices.total.g, 0);
});

test("TOP10 ranks each period independently with same-source shares", () => {
  const a = createProductAggregation(cats, { ...f, rule: null });
  a.add("a", 202401, [
    [0, "1", "Old", "A", 100, 300, 3],
    [0, "2", "New", "B", 100, 100, 1],
  ]);
  a.add("a", 202501, [
    [0, "1", "Old", "A", 100, 100, 1],
    [0, "2", "New", "B", 100, 500, 5],
  ]);
  const info = a.finish()[0].market.productInfo;
  assert.equal(info.top[0].name, "New");
  assert.equal(info.oldTop[0].name, "Old");
  assert.equal(info.top[0].share, 5 / 6);
  assert.equal(info.oldTop[0].share, 0.75);
});
