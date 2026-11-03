import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { isKnown, shift } from "../lib/metrics.js";
const read = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync("data/" + p)));
test("price matrices preserve exact totals and top brands across platform and band selections", (t) => {
  const m = JSON.parse(fs.readFileSync("data/manifest.json"));
  const scope = Object.entries(m.scopes || {})
    .filter(([k]) => m.priceLeaders?.[k])
    .sort((a, b) => a[1].ids.length - b[1].ids.length)[0];
  if (!scope) {
    t.skip("Price leaders not packaged yet");
    return;
  }
  const summary = read(m.priceLeaders[scope[0]]),
    raw = scope[1].ids.flatMap((id) => {
      const path = m.files.brandprice[id];
      if (!path) return [];
      const d = read(path);
      return Array.isArray(d)
        ? d
        : d.rows.map((r) => [r[0], r[1], d.labels[r[2]], ...r.slice(3)]);
    });
  for (let mask = 1; mask < 8; mask++)
    for (const band of [null, 0, 2, -1]) {
      const rows = raw.filter(
        (r) =>
          r[0] >= shift(m.last, -11) &&
          r[0] <= m.last &&
          mask & (1 << r[1]) &&
          (band == null || r[3] === band),
      );
      const expected = rows.reduce((s, r) => s + (r[4] || 0), 0),
        d = summary[mask + "|mat|" + (band ?? "all")];
      assert.ok(
        Math.abs(d.bins.reduce((s, r) => s + r.g, 0) - expected) < 1,
        "band total " + mask + "/" + band,
      );
      const brands = new Map();
      for (const r of rows)
        if (isKnown(r[2]))
          brands.set(r[2], (brands.get(r[2]) || 0) + (r[4] || 0));
      if (band == null) {
        for (const [name, b] of Object.entries(d.mainBands || {})) {
          const byBand = new Map();
          for (const r of rows.filter((r) => r[2] === name))
            byBand.set(r[3], (byBand.get(r[3]) || 0) + r[4]);
          const max = Math.max(...byBand.values());
          assert.ok(
            Math.abs(byBand.get(b) - max) < 1,
            "dominant band reconciles to raw records",
          );
        }
        for (const [b, items] of Object.entries(d.bandLeaders || {})) {
          const totals = new Map();
          for (const r of rows.filter((r) => r[3] === +b && isKnown(r[2])))
            totals.set(r[2], (totals.get(r[2]) || 0) + r[4]);
          assert.deepEqual(
            items.map((r) => r.name),
            [...totals]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map((r) => r[0]),
          );
        }
      }
      const leaders = [...brands].sort((a, b) => b[1] - a[1]);
      assert.deepEqual(
        d.top.slice(0, 5).map((r) => r.name),
        leaders.slice(0, 5).map((r) => r[0]),
      );
    }
});
