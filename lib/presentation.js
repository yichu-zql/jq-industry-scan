import { ratio } from "./metrics.js";
export const COLORS = [
  "#eb6834",
  "#2a78d6",
  "#6250d6",
  "#e34948",
  "#eda100",
  "#e87ba4",
  "#1baf7a",
  "#008300",
  "#4A4F5C",
  "#A3A8B3",
];
export function brandColor(name, index) {
  const fixed = [
    ["徕芬", 0],
    ["laifen", 0],
    ["戴森", 1],
    ["dyson", 1],
    ["康夫", 2],
    ["美的", 3],
    ["小米", 4],
    ["飞科", 5],
    ["追觅", 6],
    ["松下", 7],
    ["科西", 8],
  ];
  return COLORS[
    fixed.find(([key]) => name.toLowerCase().includes(key))?.[1] ?? index % 10
  ];
}
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function spark(values, color = "#8a2f5b") {
  const v = values.filter(Number.isFinite);
  if (!v.length) return '<span class="muted">暂无连续趋势</span>';
  const lo = Math.min(...v),
    hi = Math.max(...v),
    xy = (x, i) =>
      `${(i * 200) / Math.max(values.length - 1, 1)},${35 - ((x - lo) / (hi - lo || 1)) * 30}`;
  let paths = [],
    p = [];
  values.forEach((x, i) => {
    if (Number.isFinite(x)) p.push(xy(x, i));
    else if (p.length) {
      paths.push(p);
      p = [];
    }
  });
  if (p.length) paths.push(p);
  return `<svg class="spark" viewBox="0 0 200 40" role="img" aria-label="近13个月趋势">${paths.map((p) => `<polyline points="${p.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8"/>`).join("")}</svg>`;
}
export function segments(key, selected, options) {
  return `<div class="segments" role="group">${options.map(([v, n]) => `<button data-setting="${key}" data-value="${v}" aria-pressed="${selected === v}">${n}</button>`).join("")}</div>`;
}
export function seriesChart(
  labels,
  series,
  {
    percent = false,
    max = null,
    totalLabels = false,
    line = false,
    signed = false,
    format = (v) =>
      Number.isFinite(v)
        ? v.toLocaleString("zh-CN", { maximumFractionDigits: 1 })
        : "—",
    height = 280,
  } = {},
) {
  const w = 1100,
    L = 75,
    R = 20,
    T = 20,
    B = 42,
    H = height - T - B,
    N = labels.length,
    step = (w - L - R) / Math.max(1, N);
  const totals = labels.map((_, i) =>
    series.reduce(
      (s, r) => s + (Number.isFinite(r.values[i]) ? r.values[i] : 0),
      0,
    ),
  );
  const vals = series.flatMap((r) => r.values).filter(Number.isFinite);
  let hi =
      max ?? (percent ? 1 : Math.max(0, ...(line || signed ? vals : totals))),
    lo = signed ? Math.min(0, ...vals) : 0;
  if (hi === lo) hi = lo + 1;
  const y = (v) => T + ((hi - v) / (hi - lo)) * H,
    base = y(0);
  let out = "";
  for (let j = 0; j < 5; j++) {
    const v = lo + ((hi - lo) * j) / 4,
      Y = y(v);
    out += `<line x1="${L}" x2="${w - R}" y1="${Y}" y2="${Y}" stroke="var(--line)"/><text x="${L - 9}" y="${Y + 4}" text-anchor="end">${esc(format(v))}</text>`;
  }
  if (line) {
    series.forEach((s, k) => {
      let points = [];
      const flush = () => {
        if (points.length)
          out += `<polyline points="${points.join(" ")}" fill="none" stroke="${s.color || COLORS[k % 10]}" stroke-width="2"/>`;
        points = [];
      };
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) {
          flush();
          return;
        }
        const X = L + (i + 0.5) * step;
        points.push(`${X},${y(v)}`);
        out += `<circle tabindex="0" cx="${X}" cy="${y(v)}" r="3" fill="${s.color || COLORS[k % 10]}"><title>${esc(labels[i] + " " + s.name + " " + format(v))}</title></circle>`;
      });
      flush();
    });
  } else
    labels.forEach((label, i) => {
      let acc = 0;
      series.forEach((s, k) => {
        let raw = s.values[i];
        if (!Number.isFinite(raw)) return;
        let v = percent ? ratio(raw, totals[i]) : raw;
        if (v == null) return;
        const a = signed ? 0 : acc,
          b = a + v;
        out += `<rect tabindex="0" x="${L + i * step + step * 0.12}" y="${Math.min(y(a), y(b))}" width="${step * 0.76}" height="${Math.max(0.5, Math.abs(y(a) - y(b)))}" rx="2" fill="${signed ? (v >= 0 ? "var(--up)" : "var(--down)") : s.color || COLORS[k % 10]}"><title>${esc(label + " · " + s.name + " " + format(percent ? v : raw))}</title></rect>`;
        acc = b;
      });
      if (totalLabels && series.every((s) => Number.isFinite(s.values[i])))
        out += `<text class="stack-total" x="${L + (i + 0.5) * step}" y="${y(acc) - 6}" text-anchor="middle">${esc(format(acc))}</text>`;
    });
  labels.forEach((l, i) => {
    if (i % Math.max(1, Math.ceil(N / 12)) === 0 || i === N - 1)
      out += `<text x="${L + (i + 0.5) * step}" y="${height - 15}" text-anchor="middle">${esc(l)}</text>`;
  });
  return `<div class="chart-legend">${series.map((s, i) => `<span><i style="background:${s.color || COLORS[i % 10]}"></i>${esc(s.name)}</span>`).join("")}</div><svg class="reference-chart" viewBox="0 0 ${w} ${height}" role="img" aria-label="${esc(series.map((s) => s.name).join("、"))}">${out}</svg>`;
}
const PRICE_COLORS = [
  "#f1e2e9",
  "#e6c8d7",
  "#d9abc1",
  "#ca8bab",
  "#b76d95",
  "#a14e7e",
  "#883663",
  "#6d284f",
  "#501b3b",
  "#9098a4",
];
export function horizontalMix(
  rows,
  format = (v) => (v * 100).toFixed(1) + "%",
) {
  return `<div class="chart-legend">${(rows[0]?.parts || []).map((p, i) => `<span><i style="background:${PRICE_COLORS[i % 10]}"></i>${esc(p.name)}</span>`).join("")}</div><div class="mix-chart">${rows
    .map((r) => {
      const sum = r.parts.reduce((a, p) => a + (p.g || 0), 0);
      return `<div class="mix-row"><span>${esc(r.label)}</span><div class="mix-track">${r.parts
        .map((p, i) =>
          p.g > 0
            ? `<button ${p.band != null ? `data-price="${p.band}"` : ""} style="width:${(p.g / sum) * 100}%;background:${PRICE_COLORS[i % 10]};color:${i < 3 ? "var(--ink)" : "white"}" title="${esc(p.name + " " + format(p.g / sum))}">${p.g / sum > 0.07 ? format(p.g / sum) : ""}</button>`
            : "",
        )
        .join("")}</div></div>`;
    })
    .join("")}</div>`;
}
const tablePages = new Map(),
  lazyRows = new Map();
export function compactTableBody(id, body) {
  const rows = body.match(/<tr[\s>][\s\S]*?<\/tr>/g) || [];
  if (rows.length <= 200) {
    lazyRows.delete(id);
    return body;
  }
  lazyRows.set(id, rows);
  const saved = tablePages.get(id) || { page: 0, size: 10 };
  const page = Math.min(saved.page, Math.ceil(rows.length / saved.size) - 1);
  return rows.slice(page * saved.size, (page + 1) * saved.size).join("");
}
export function paginateTables(root = document) {
  for (const table of root.querySelectorAll("table")) {
    if (table.id === "growth-table" || table.dataset.paged) continue;
    const lazy = lazyRows.get(table.id);
    const rows = lazy || [...(table.tBodies[0]?.rows || [])];
    if (rows.length <= 10) continue;
    table.dataset.paged = "true";
    let { page, size } = tablePages.get(table.id) || {
      page: 0,
      size: table.id === "industry-table" ? 20 : 10,
    };
    const controls = document.createElement("div");
    controls.className = "pagination";
    controls.innerHTML =
      '<label>每页 <select aria-label="每页行数"><option>10</option><option>20</option><option>50</option></select></label><small></small><button>上一页</button><button>下一页</button>';
    table.parentElement.after(controls);
    controls.querySelector("select").value = String(size);
    const buttons = controls.querySelectorAll("button"),
      draw = () => {
        page = Math.min(page, Math.ceil(rows.length / size) - 1);
        tablePages.set(table.id, { page, size });
        if (lazy)
          table.tBodies[0].innerHTML = rows
            .slice(page * size, (page + 1) * size)
            .join("");
        else
          rows.forEach(
            (r, i) => (r.hidden = i < page * size || i >= (page + 1) * size),
          );
        controls.querySelector("small").textContent =
          `共 ${rows.length} 行 · ${page + 1}/${Math.ceil(rows.length / size)} 页`;
        buttons[0].disabled = !page;
        buttons[1].disabled = (page + 1) * size >= rows.length;
        table.parentElement.scrollTop = 0;
      };
    buttons[0].onclick = () => {
      page--;
      draw();
      if (lazy)
        table.dispatchEvent(new window.Event("table-page", { bubbles: true }));
    };
    buttons[1].onclick = () => {
      page++;
      draw();
      if (lazy)
        table.dispatchEvent(new window.Event("table-page", { bubbles: true }));
    };
    controls.querySelector("select").onchange = (e) => {
      size = +e.target.value;
      page = 0;
      draw();
      if (lazy)
        table.dispatchEvent(new window.Event("table-page", { bubbles: true }));
    };
    draw();
  }
}
export function installViewportTableHeaders() {
  const host = document.createElement("div");
  host.className = "floating-table-head";
  host.setAttribute("aria-hidden", "true");
  host.hidden = true;
  document.body.append(host);
  let queued = false,
    source = null;
  const update = () => {
    queued = false;
    const top =
      document.querySelector(".global-top")?.getBoundingClientRect().bottom ||
      0;
    const candidates = [...document.querySelectorAll("#main .scroll>table")];
    const table = candidates.find((t) => {
      const r = t.parentElement.getBoundingClientRect();
      return r.top < top && r.bottom > top + 60;
    });
    if (!table) {
      host.hidden = true;
      source = null;
      return;
    }
    const wrap = table.parentElement,
      r = wrap.getBoundingClientRect();
    host.hidden = false;
    host.style.cssText = `top:${top}px;left:${Math.max(0, r.left)}px;width:${Math.min(r.width, document.documentElement.clientWidth - r.left)}px`;
    if (source !== table) {
      host.replaceChildren();
      const clone = table.cloneNode(false);
      clone.removeAttribute("id");
      clone.append(table.tHead.cloneNode(true));
      host.append(clone);
      source = table;
    }
    const clone = host.firstElementChild;
    clone.style.width = table.getBoundingClientRect().width + "px";
    clone.style.transform = `translateX(${-wrap.scrollLeft}px)`;
    [...clone.querySelectorAll("th")].forEach(
      (th, i) =>
        (th.style.width =
          table.tHead.querySelectorAll("th")[i].getBoundingClientRect().width +
          "px"),
    );
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      window.requestAnimationFrame(update);
    }
  };
  document.addEventListener("scroll", schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", schedule, { passive: true });
  new MutationObserver(schedule).observe(document.getElementById("main"), {
    childList: true,
    subtree: true,
  });
}
