import { shift } from "./metrics.js";
export function selectedPeriod(state, first) {
  let start = state.start;
  if (state.mode === "mat") start = shift(state.end, -11);
  else if (state.mode === "month") start = state.end;
  else if (state.mode === "ytd") start = Math.floor(state.end / 100) * 100 + 1;
  else if (state.mode === "years") {
    const firstYear = Math.floor(first / 100),
      endYear = Math.floor(state.end / 100);
    const year = Math.max(
      firstYear,
      Math.min(endYear, state.yearsStart || firstYear),
    );
    start = Math.max(first, year * 100 + 1);
  }
  return { start, end: state.end };
}
export function setYearRange(state, first, last, startYear, endYear) {
  const low = Math.floor(first / 100),
    high = Math.floor(last / 100);
  const end = Math.max(low, Math.min(high, endYear));
  state.yearsStart = Math.max(low, Math.min(end, startYear));
  state.end = Math.min(last, end * 100 + 12);
  state.start = Math.max(first, state.yearsStart * 100 + 1);
}
