import test from "node:test";
import assert from "node:assert/strict";
import { selectedPeriod, setYearRange } from "../lib/time-range.js";
test("all five quick periods and year boundaries resolve to the selected range", () => {
  for (const [mode, start] of [
    ["mat", 202510],
    ["ytd", 202601],
    ["month", 202609],
    ["custom", 202503],
    ["years", 202201],
  ])
    assert.deepEqual(
      selectedPeriod({ mode, start: 202503, end: 202609 }, 202201),
      { start, end: 202609 },
    );
  const s = { mode: "years" };
  setYearRange(s, 202201, 202609, 2023, 2025);
  assert.deepEqual(selectedPeriod(s, 202201), { start: 202301, end: 202512 });
  setYearRange(s, 202201, 202609, 2025, 2024);
  assert.deepEqual(selectedPeriod(s, 202201), { start: 202401, end: 202412 });
  setYearRange(s, 202201, 202609, 2022, 2026);
  assert.deepEqual(selectedPeriod(s, 202201), { start: 202201, end: 202609 });
});
