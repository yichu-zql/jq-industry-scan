import { commonUnit, number, percent } from "./trend-model.js?v=2.4.0";
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function chartSVG(model) {
  const W = 1100,
    H = 500,
    unit = commonUnit(model.totals),
    left = 80,
    right = 1000,
    top = 108 + Math.max(0, Math.ceil(model.series.length / 3) - 3) * 25,
    bottom = 420,
    n = model.labels.length;
  const positive = model.labels.map((_, i) =>
      model.series.reduce((s, v) => s + Math.max(v.values[i] || 0, 0), 0),
    ),
    negative = model.labels.map((_, i) =>
      model.series.reduce((s, v) => s + Math.min(v.values[i] || 0, 0), 0),
    );
  const high = Math.max(...positive, 1) * 1.15,
    low = Math.min(...negative, 0) * 1.1,
    y = (v) => bottom - ((v - low) / (high - low)) * (bottom - top),
    values = model.growth.filter(Number.isFinite),
    min = Math.min(0, ...values),
    max = Math.max(0.05, ...values),
    pad = Math.max(0.02, (max - min) * 0.2),
    lo = min - pad,
    hi = max + pad,
    gy = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top),
    x = (i) => left + ((i + 0.5) * (right - left)) / n,
    bw = Math.min(125, ((right - left) / n) * 0.45);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="500" viewBox="0 0 1100 500" role="img" aria-label="${esc(model.title)}"><rect width="1100" height="500" fill="white"/><style>text{font-family:Microsoft YaHei,Arial,sans-serif;text-anchor:middle;fill:#555;font-size:14px}.value{font-size:15px;fill:#222}.growth{fill:#333;paint-order:stroke;stroke:white;stroke-width:4px;stroke-linejoin:round}</style><title>${esc(model.title)}</title>`;
  model.series.forEach((v, i) => {
    const col = i % 3,
      row = Math.floor(i / 3),
      lx = 180 + col * 340,
      ly = 24 + row * 25;
    const short = v.name.split(" / ").at(-1);
    s += `<rect x="${lx - 100}" y="${ly - 10}" width="10" height="10" fill="${v.color}"/><text x="${lx + 30}" y="${ly}"><title>${esc(v.name)}</title>${esc(short.length > 24 ? short.slice(0, 23) + "…" : short)}</text>`;
  });
  s += `<text x="80" y="${top - 12}">单位：${unit.label}</text><text x="1000" y="${top - 12}">合计可比同比</text>`;
  for (let j = 0; j <= 5; j++) {
    const yy = top + ((bottom - top) * j) / 5;
    s += `<line x1="${left}" x2="${right}" y1="${yy}" y2="${yy}" stroke="#eeeeee"/><text x="42" y="${yy + 5}">${((high - ((high - low) * j) / 5) / unit.scale).toFixed(2)}</text><text x="1051" y="${yy + 5}">${percent(hi - ((hi - lo) * j) / 5)}</text>`;
  }
  model.labels.forEach((label, i) => {
    let pos = 0,
      neg = 0;
    model.series.forEach((v) => {
      const value = v.values[i];
      if (!Number.isFinite(value)) return;
      const base = value >= 0 ? pos : neg,
        next = base + value;
      if (value >= 0) pos = next;
      else neg = next;
      const yy = Math.min(y(base), y(next)),
        h = Math.abs(y(base) - y(next));
      s += `<rect x="${x(i) - bw / 2}" y="${yy}" width="${bw}" height="${h}" fill="${v.color}"><title>${esc(v.name)} · ${esc(label)} · ${number(value)}元</title></rect>`;
      if (h >= 22)
        s += `<text class="value" x="${x(i)}" y="${yy + h / 2 + 5}" style="fill:${["#E6004C", "#FF0080"].includes(v.color) ? "white" : "#333"}">${(value / unit.scale).toFixed(2)}</text>`;
    });
    s += `<text x="${x(i)}" y="448">${esc(label)}</text>`;
  });
  let previous = null;
  model.growth.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      previous = null;
      return;
    }
    const point = [x(i), gy(v)];
    if (previous)
      s += `<line x1="${previous[0]}" y1="${previous[1]}" x2="${point[0]}" y2="${point[1]}" stroke="#444" stroke-width="2"/>`;
    s += `<circle cx="${point[0]}" cy="${point[1]}" r="3.5" fill="white" stroke="#444"/><text class="growth" x="${point[0]}" y="${point[1] - 12}">${v > 0 ? "+" : ""}${percent(v)}</text>`;
    previous = point;
  });
  s +=
    '<text x="550" y="485" style="font-size:12px">首年为展示基期；末年按所选月份累计，同比均与上年相同月份比较。</text></svg>';
  return s;
}
export function rawRows(m) {
  return [
    [
      "年份",
      ...m.series.map((v) => v.name + " GMV（元）"),
      "合计GMV（元）",
      "可比本期GMV（元）",
      "可比同期GMV（元）",
      "合计可比同比（小数）",
    ],
    ...m.labels.map((label, i) => [
      label,
      ...m.series.map((v) => v.values[i]),
      m.totals[i],
      m.pairCurrent[i],
      m.pairPrevious[i],
      m.growth[i],
    ]),
  ];
}
export function chartTable(m) {
  return `<div class="trend-table-wrap"><table class="trend-data"><thead><tr><th>品类 / 平台</th>${m.labels.map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>${m.series.map((v) => `<tr><th><i style="background:${v.color}"></i>${esc(v.name)}</th>${v.values.map((x) => `<td>${number(x)}</td>`).join("")}</tr>`).join("")}<tr class="trend-total"><th>合计GMV（元）</th>${m.totals.map((v) => `<td>${number(v)}</td>`).join("")}</tr><tr><th>合计可比同比</th>${m.growth.map((v, i) => `<td title="可比金额覆盖 ${percent(m.coverage[i])}">${percent(v)}</td>`).join("")}</tr></tbody></table></div>`;
}
