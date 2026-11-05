import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { isKnown, shift } from "../lib/metrics.js";
const read = (p) =>
  JSON.parse(
    p.endsWith(".gz")
      ? zlib.gunzipSync(fs.readFileSync(p))
      : fs.readFileSync(p),
  );
test("distribution snapshots match exact pooled raw brands across dates and masks", () => {
  const m = read("data/manifest.json");
  assert.ok(m.distribution, "monthly distributions are required");
  assert.equal(m.distribution.sourceVersion, m.version);
  const industry = read("data/" + m.industry),
    cats = industry.categories.filter(
      (c) => c.path[0] === "个护仪器" && c.path[1] === "美体瘦身",
    );
  const rows = cats.flatMap((c) => {
    const d = read("data/" + m.files.brand[c.id]);
    return (
      Array.isArray(d)
        ? d
        : d.rows.map((r) => [r[0], r[1], d.labels[r[2]], ...r.slice(3)])
    ).map((r) => ({ id: c.id, row: r }));
  });
  for (const end of [202212, 202512, m.last]) {
    const summary = read("data/" + m.distribution.months[end]);
    for (const selected of [cats, ...cats.map((c) => [c])])
      for (let mask = 1; mask < 8; mask++) {
        const ids = new Set(selected.map((c) => c.id)),
          brands = new Map();
        for (const {
          id,
          row: [month, p, name, g],
        } of rows)
          if (
            ids.has(id) &&
            month >= shift(end, -11) &&
            month <= end &&
            mask & (1 << p)
          )
            brands.set(name, (brands.get(name) || 0) + (g || 0));
        const total = [...brands.values()].reduce((a, b) => a + b, 0),
          top = [...brands]
            .filter(([name]) => isKnown(name))
            .map(([, g]) => g)
            .sort((a, b) => b - a)
            .slice(0, 5)
            .reduce((a, b) => a + b, 0);
        const key = JSON.stringify(
          selected.length === 1 ? selected[0].path : ["个护仪器", "美体瘦身"],
        );
        const actual = summary[key][mask - 1];
        if (total <= 0) assert.equal(actual, null);
        else
          assert.ok(
            Math.abs(actual - top / total) < 1e-8,
            `${key} ${end} ${mask}`,
          );
      }
  }
  const latest = read("data/" + m.distribution.months[m.last]);
  for (const [scope, v] of Object.entries(m.scopes))
    if (scope !== "scope_all") {
      const leaders = read("data/" + m.leaders[scope]);
      for (let mask = 1; mask < 8; mask++) {
        const all = leaders[mask + "|mat"].cur,
          total = all.reduce((s, r) => s + r.g, 0),
          top = all
            .filter((r) => isKnown(r.name))
            .slice(0, 5)
            .reduce((s, r) => s + r.g, 0);
        const c = industry.categories.find((c) => c.id === v.ids[0]);
        assert.ok(
          Math.abs(
            latest[JSON.stringify([c.path[0]])][mask - 1] - top / total,
          ) < 1e-8,
        );
      }
    }
  for (const p of Object.values(m.distribution.months))
    assert.ok(
      fs.statSync("data/" + p).size < 200000,
      "each monthly summary remains small",
    );
});
