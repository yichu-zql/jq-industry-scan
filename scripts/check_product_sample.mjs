import fs from "node:fs";
import zlib from "node:zlib";
import assert from "node:assert/strict";
import { createProductAggregation } from "../lib/trend-products.js";
import { parseTagRule } from "../lib/trend-rules.js";
const m = JSON.parse(fs.readFileSync("data/manifest.json"));
const ind = JSON.parse(zlib.gunzipSync(fs.readFileSync("data/" + m.industry)));
const name = process.argv[2] || "吹风机";
const candidates = ind.categories.filter(
  (c) => c.path.join("/") === name || c.id === name || c.path[2] === name,
);
assert.equal(candidates.length, 1, "Use a unique category ID or full path");
const c = candidates[0],
  index = JSON.parse(fs.readFileSync(".cache/product-snapshot/index.json"));
const f = {
  ids: [c.id],
  plats: [0, 1, 2],
  startYear: 2024,
  endYear: 2026,
  cutoff: 9,
  rule: parseTagRule(process.argv[3] || "包含吹风机，不包含配件"),
};
const a = createProductAggregation(ind.categories, f);
const parts = (index.files[c.id] || []).filter(
  (p) => p.month >= 202301 && p.month <= 202609,
);
for (const p of parts)
  a.add(
    c.id,
    p.month,
    JSON.parse(
      zlib.gunzipSync(fs.readFileSync(".cache/product-snapshot/" + p.path)),
    ),
  );
const [market, brands, prices] = a.finish();
const g = market.market.kpi.g;
for (const total of [brands.brands.total, prices.prices.total.g])
  assert.ok(
    Math.abs((total ?? 0) - (g ?? 0)) < 1,
    "Matched-source totals differ",
  );
console.log(
  JSON.stringify({
    category: c.path.join("/"),
    months: parts.length,
    gmv: g,
    products: market.market.productInfo.products,
    priceGMV: prices.prices.total.g,
    brandGMV: brands.brands.total,
  }),
);
