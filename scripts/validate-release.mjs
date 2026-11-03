import fs from "node:fs";
import zlib from "node:zlib";
import assert from "node:assert/strict";
const m = JSON.parse(fs.readFileSync("data/manifest.json", "utf8"));
assert.equal(m.preview, false, "Do not publish preview snapshots");
assert.equal(m.audit.industryConflicts, 0);
for (const kind of ["brand", "price", "brandprice"])
  assert.ok(Object.keys(m.files[kind] || {}).length > 0, kind + " missing");
const paths = [
  m.industry,
  m.brandIndex,
  ...Object.values(m.leaders || {}),
  ...Object.values(m.priceLeaders || {}),
  ...Object.values(m.insights || {}),
  ...Object.values(m.files)
    .flatMap((o) => Object.values(o))
    .flatMap((v) => (Array.isArray(v) ? v.map((r) => r.path) : [v])),
];
let bytes = 0;
for (const p of new Set(paths)) {
  assert.ok(!p.includes(".."));
  assert.ok(fs.existsSync("data/" + p), p);
  const size = fs.statSync("data/" + p).size;
  bytes += size;
  assert.ok(size < 95 * 1024 * 1024, "GitHub single-file limit");
  JSON.parse(zlib.gunzipSync(fs.readFileSync("data/" + p)));
}
assert.ok(
  bytes < 950 * 1024 * 1024,
  "Published aggregates must fit within GitHub Pages site limit",
);
for (const p of ["index.html", "app.js", "styles.css", "lib/metrics.js"]) {
  const s = fs.readFileSync(p, "utf8");
  assert.ok(
    !/password\s*[:=]\s*['"][^'"]+['"]/i.test(s),
    p + " credential-like literal",
  );
}
console.log("Release checks passed:", m.version);
