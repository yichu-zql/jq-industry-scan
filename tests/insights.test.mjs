import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { brandRank, isKnown, shift } from "../lib/metrics.js";
function read(path) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path)));
}
test("overview summaries equal full brand rows for all seven platform combinations", (t) => {
  if (!fs.existsSync("data/manifest.json")) return t.skip("Data unavailable");
  const m = JSON.parse(fs.readFileSync("data/manifest.json"));
  if (!m.insights?.[m.last]) return t.skip("Insight bundles not packaged yet");
  const summaries = read("data/" + m.insights[m.last]);
  const files = Object.entries(m.files.brand)
    .filter(([id]) => !id.startsWith("scope_"))
    .slice(0, 5);
  for (const [id, path] of files) {
    let data = read("data/" + path);
    if (!Array.isArray(data)) {
      for (const row of data.rows) row[2] = data.labels[row[2]];
      data = data.rows;
    }
    for (let mask = 1; mask < 8; mask++)
      for (const [key, start, end] of [
        ["cur", shift(m.last, -11), m.last],
        ["prev", shift(m.last, -23), shift(m.last, -12)],
      ]) {
        const ranks = brandRank(
            data,
            [0, 1, 2].filter((p) => mask & (1 << p)),
            start,
            end,
          ),
          expected = ranks.reduce((s, r) => s + r.g, 0),
          s = summaries[id][mask][key];
        assert.ok(Math.abs(s.total - expected) < 0.01, id + " total");
        assert.ok(
          Math.abs(
            s.top.reduce((n, r) => n + r[1], 0) -
              ranks
                .filter((r) => isKnown(r.name))
                .slice(0, 5)
                .reduce((n, r) => n + r.g, 0),
          ) < 0.01,
          id + " top five",
        );
      }
  }
});
