import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { brandRank, isKnown, shift } from "../lib/metrics.js";
const read = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync("data/" + p)));
test("common-period leaders equal full monthly scope records for every platform mask", (t) => {
  const m = JSON.parse(fs.readFileSync("data/manifest.json"));
  const scope = Object.keys(m.leaders || {}).find((k) => k !== "scope_all");
  if (!scope) {
    t.skip("Leaders not packaged yet");
    return;
  }
  const summary = read(m.leaders[scope]);
  const rows = m.files.brand[scope]
    .filter((x) => x.month >= shift(m.last, -23))
    .flatMap((x) => {
      const d = read(x.path);
      return d.rows.map((r) => [r[0], r[1], d.labels[r[2]], r[3], r[4]]);
    });
  for (let mask = 1; mask < 8; mask++)
    for (const [mode, start] of [
      ["mat", shift(m.last, -11)],
      ["ytd", Math.floor(m.last / 100) * 100 + 1],
      ["month", m.last],
    ]) {
      const ps = [0, 1, 2].filter((p) => mask & (1 << p)),
        d = summary[mask + "|" + mode],
        expected = brandRank(rows, ps, start, m.last),
        known = expected.filter((r) => isKnown(r.name));
      assert.equal(d.knownCount, known.length);
      assert.deepEqual(
        d.cur
          .filter((r) => isKnown(r.name))
          .slice(0, 10)
          .map((r) => r.name),
        known.slice(0, 10).map((r) => r.name),
      );
      const sum = (a) => a.reduce((s, r) => s + r.g, 0);
      assert.ok(
        Math.abs(sum(d.cur) - sum(expected)) < 1,
        "total preserved " + mask + mode,
      );
      const previous = brandRank(
        rows,
        ps,
        shift(start, -12),
        shift(m.last, -12),
      );
      assert.ok(
        Math.abs(sum(d.prev) - sum(previous)) < 1,
        "prior total preserved",
      );
    }
});
