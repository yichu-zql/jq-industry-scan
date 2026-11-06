import { percent, number } from "./trend-model.js?v=2.6.0";
import { esc } from "./trend-chart.js?v=2.6.0";
export const PLATFORM_COLORS = ["#cc2e29", "#334f93", "#20242d"];
export function dataBar(value, label = percent, max = 1, signed = false) {
  if (!Number.isFinite(value)) return "—";
  const w =
    Math.min(100, (Math.abs(value) / (max || 1)) * 100) * (signed ? 0.5 : 1);
  return `<span class="trend-bar ${signed ? "signed" : ""}" style="--bar-width:${w}%;--bar-left:${signed ? (value < 0 ? 50 - w : 50) : 0}%;--bar-color:${signed ? (value < 0 ? "#d87d7d" : "#75af9a") : "#ba8ba3"}"><i></i><span>${esc(label(value))}</span></span>`;
}
export function platformLegend() {
  return `<small class="platform-legend">${["天猫", "京东", "抖音"].map((v, i) => `<span style="color:${PLATFORM_COLORS[i]}">■${v}</span>`).join(" ")}</small>`;
}
export function platformMix(v) {
  if (!v || !(v.g > 0)) return "—";
  const shares = [0, 1, 2].map((p) =>
    Number.isFinite(v.plats[p]) ? v.plats[p] / v.g : null,
  );
  return `<div class="platform-mix"><span class="mix-strip">${shares.map((s, i) => `<i style="width:${Math.max(0, s || 0) * 100}%;background:${PLATFORM_COLORS[i]}"></i>`).join("")}</span><span>${shares.map((s, i) => `<b style="color:${PLATFORM_COLORS[i]}">${percent(s)}</b>`).join(" / ")}</span></div>`;
}
export function metricTable(rows, cols = []) {
  const max = rows[0].map((_, i) =>
    Math.max(
      ...rows.slice(1).map((r) => Math.abs(Number.isFinite(r[i]) ? r[i] : 0)),
      0.000001,
    ),
  );
  return `<div class="trend-table-wrap"><table class="trend-data"><thead><tr>${rows[0].map((v) => `<th>${esc(String(v).replaceAll("（小数）", ""))}</th>`).join("")}</tr></thead><tbody>${rows
    .slice(1)
    .map(
      (r) =>
        `<tr>${r.map((v, i) => `<td>${typeof v === "number" ? (cols.includes(i) ? dataBar(v, percent, max[i], /同比|变化/.test(rows[0][i])) : number(v)) : esc(v ?? "—")}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table></div>`;
}
