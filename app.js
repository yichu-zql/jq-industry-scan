import {
  spark,
  segments,
  seriesChart,
  horizontalMix,
  paginateTables,
  compactTableBody,
  installViewportTableHeaders,
  COLORS,
} from "./lib/presentation.js";
const VERSION = document.querySelector('meta[name="app-version"]').content;
import {
  PLATFORMS,
  GROWTH,
  BANDS,
  PRICE,
  shift,
  months,
  ratio,
  yoy,
  scale,
  lastFullYear,
  annualRange,
  indexIndustry,
  aggregate,
  pairedAggregate,
  categoryMetrics,
  brandRank,
  sourceConcentration as concentration,
  isKnown,
  csv,
} from "./lib/metrics.js";
const $ = (id) => document.getElementById(id),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const ym = (v) =>
    Number.isFinite(v) ? String(v).slice(0, 4) + "-" + String(v).slice(4) : "—",
  num = (v) =>
    Number.isFinite(v)
      ? v.toLocaleString("zh-CN", { maximumFractionDigits: 1 })
      : "—";
const money = (v) =>
  !Number.isFinite(v)
    ? "—"
    : Math.abs(v) >= 1e8
      ? num(v / 1e8) + "亿"
      : Math.abs(v) >= 1e4
        ? num(v / 1e4) + "万"
        : num(v);
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—"),
  delta = (v, pp = false) =>
    Number.isFinite(v)
      ? `<span class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}${pp ? "pp" : "%"}</span>`
      : "—";
const cell = (v, format, signed = false) =>
  `<td class="databar" ${Number.isFinite(v) ? `data-value="${v}" data-signed="${signed}"` : ""}>${format(v)}</td>`;
const views = [
  ["overview", "行业概览"],
  ["market", "类目大盘"],
  ["price", "类目价格带"],
  ["competition", "竞品格局"],
  ["brand", "品牌深挖"],
  ["method", "口径与数据"],
];
let brandCategoryIndex = null;
let manifest,
  industry,
  index,
  categories,
  catMap,
  token = 0,
  metricsMemo,
  metricsKey,
  returnState = null;
let renderStartedAt = 0;
if (globalThis.PerformanceObserver) {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.startTime >= renderStartedAt) {
          const main = $("main");
          main.dataset.longTaskMs = String(
            Math.max(
              Number(main.dataset.longTaskMs || 0),
              Math.round(e.duration),
            ),
          );
        }
    }).observe({ type: "longtask", buffered: false });
  } catch {}
}
const leaderCache = new Map();
const insightCache = new Map();
let initialInsightPromise = null;
const fileCache = new Map(),
  exportTables = new Map();
let toastTimer,
  activeController = new AbortController(),
  pendingFiles = new Map(),
  metricsWorker = null,
  workerSeq = 0;
const workerJobs = new Map();
let dataWorker = null,
  dataSeq = 0;
const dataJobs = new Map();
let analysisWorker = null,
  analysisSeq = 0;
const analysisJobs = new Map();
let S = {
  view: "overview",
  mode: "mat",
  end: 0,
  start: 0,
  plats: [0, 1, 2],
  cats: null,
  expanded: [],
  only: true,
  matrix: null,
  page: 0,
  sort: "g",
  desc: true,
  brand: "",
  compare: "",
  price: null,
  priceSort: "g",
  search: "",
};
try {
  const saved = JSON.parse(localStorage.getItem("jq-scan-v2") || "null");
  if (saved?.version === 1) Object.assign(S, saved.state);
} catch {}
function persist() {
  try {
    localStorage.setItem(
      "jq-scan-v2",
      JSON.stringify({ version: 1, state: S }),
    );
  } catch {}
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
async function jsonFile(url, signal) {
  if (dataWorker) {
    const id = ++dataSeq;
    return new Promise((resolve, reject) => {
      const stop = () => {
        dataJobs.delete(id);
        reject(new DOMException("请求已取消", "AbortError"));
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop, { once: true });
      dataJobs.set(id, {
        resolve: (r) => {
          signal?.removeEventListener("abort", stop);
          resolve(r);
        },
        reject,
      });
      dataWorker.postMessage({
        type: "load",
        id,
        url: new URL(url, location.href).href,
      });
    });
  }
  const r = await fetch(url, { signal });
  if (!r.ok) throw Error(`数据文件读取失败（${r.status}）：${url}`);
  if (url.includes(".gz")) {
    if (!globalThis.DecompressionStream)
      throw Error(
        "当前浏览器不支持压缩数据读取，请使用新版 Chrome、Edge 或 Safari。",
      );
    return JSON.parse(
      await new Response(
        r.body.pipeThrough(new DecompressionStream("gzip")),
      ).text(),
    );
  }
  return r.json();
}
function load(kind, id) {
  const key = kind + "/" + id;
  if (fileCache.has(key)) return Promise.resolve(fileCache.get(key));
  if (pendingFiles.has(key)) return pendingFiles.get(key);
  const entry = manifest.files?.[kind]?.[id],
    signal = activeController.signal;
  const promise = entry
    ? (Array.isArray(entry)
        ? Promise.all(
            entry.map((e) => jsonFile("./data/" + e.path, signal)),
          ).then((parts) =>
            parts.flatMap((data) =>
              Array.isArray(data)
                ? data
                : data.rows.map((r) => {
                    r[2] = data.labels[r[2]];
                    return r;
                  }),
            ),
          )
        : jsonFile("./data/" + entry, signal)
      ).then((data) => {
        const rows = Array.isArray(data)
          ? data
          : data.rows.map((r) => {
              r[2] = data.labels[r[2]];
              return r;
            });
        fileCache.set(key, rows);
        return rows;
      })
    : Promise.resolve([]);
  pendingFiles.set(key, promise);
  return promise;
}

async function loadMany(kind, ids, t, raw = false) {
  if (!raw && manifest.scopes) {
    const set = new Set(ids),
      scope = Object.entries(manifest.scopes).find(
        ([key, v]) =>
          v.ids.length === set.size &&
          v.ids.every((id) => set.has(id)) &&
          manifest.files?.[kind]?.[key],
      );
    if (scope) {
      const rows = await load(kind, scope[0]);
      return [{ id: scope[0], rows }];
    }
  }
  const result = [];
  let n = 0,
    done = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (n < ids.length) {
        if (t !== token) return;
        const id = ids[n++],
          rows = await load(kind, id);
        result.push({ id, rows });
        done++;
        if (done % 50 === 0 && t === token) {
          const e =
            $("load-progress") ||
            $("brand-load-progress") ||
            $("brand-price-progress");
          if (e) e.textContent = `正在加载 ${done} / ${ids.length} 个类目…`;
        }
      }
    }),
  );
  return result;
}
function ids() {
  return S.cats === null
    ? categories.map((c) => c.id)
    : S.cats.filter((id) => catMap.has(id));
}
function period() {
  let start = S.start;
  if (S.mode === "mat") start = shift(S.end, -11);
  if (S.mode === "month") start = S.end;
  if (["ytd", "years"].includes(S.mode))
    start = Math.floor(S.end / 100) * 100 + 1;
  return { start, end: S.end };
}
function periods() {
  if (S.mode !== "years")
    return [{ ...period(), label: ym(period().start) + "—" + ym(S.end) }];
  const out = [];
  for (
    let y = Math.floor(manifest.first / 100);
    y <= Math.floor(S.end / 100);
    y++
  )
    out.push({
      start: y * 100 + 1,
      end: y === Math.floor(S.end / 100) ? S.end : y * 100 + 12,
      label:
        y +
        "年" +
        (y === Math.floor(S.end / 100) && S.end % 100 < 12
          ? "（至" + (S.end % 100) + "月）"
          : ""),
    });
  return out;
}
const aggregateCache = new Map();
function cachedAggregate(kind, list, plats, start, end) {
  const key =
    kind +
    "|" +
    plats.join(",") +
    "|" +
    start +
    "|" +
    end +
    "|" +
    list.join(",");
  if (aggregateCache.has(key)) return aggregateCache.get(key);
  const result =
    kind === "pair"
      ? pairedAggregate(index, list, plats, start, end)
      : aggregate(index, list, plats, start, end);
  aggregateCache.set(key, result);
  if (aggregateCache.size > 9000)
    aggregateCache.delete(aggregateCache.keys().next().value);
  return result;
}
function totals(list = ids(), start = period().start, end = S.end) {
  return cachedAggregate("sum", list, S.plats, start, end);
}
function prevTotals(list = ids(), start = period().start, end = S.end) {
  return totals(list, shift(start, -12), shift(end, -12));
}
function comparable(
  list = ids(),
  start = period().start,
  end = S.end,
  plats = S.plats,
) {
  return cachedAggregate("pair", list, plats, start, end);
}
function compCoverage(c, t, p) {
  return (
    "可比覆盖：本期 " +
    pct(ratio(c.cur.g, t.g)) +
    " / 上期 " +
    pct(ratio(c.prev.g, p.g))
  );
}

function calcMetrics() {
  const P = period(),
    key = JSON.stringify([ids(), S.plats, P]);
  if (key !== metricsKey) {
    metricsKey = key;
    metricsMemo = ids().map((id) => ({
      ...categoryMetrics(index, id, S.plats, P.start, P.end),
      ...catMap.get(id),
    }));
  }
  return metricsMemo;
}
function unitStat(label, v, sub = "") {
  return `<div class="stat"><small>${label}</small><strong>${v}</strong><small>${sub}</small></div>`;
}
function section(title, subtitle, body, action = "") {
  return `<section class="panel"><div class="section-head"><div><h2>${title}</h2><small>${subtitle}</small></div>${action}</div>${body}</section>`;
}
function table(id, headers, body, exportRows) {
  body = compactTableBody(id, body);
  if (exportRows)
    exportTables.set(id, [
      headers.map((h) =>
        String(h)
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
      ...exportRows,
    ]);
  return `<div class="scroll"><table id="${id}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="empty">当前范围暂无可展示数据</td></tr>`}</tbody></table></div>`;
}
function exportButton(id) {
  return `<button data-export="${id}">导出当前结果 CSV</button>`;
}
function completeNote(t) {
  return t.complete
    ? ""
    : `<p class="note warning">当前范围存在缺月或缺平台（有记录 ${t.present.toLocaleString()} / 应有 ${t.expected.toLocaleString()} 个类目月份平台组合）。规模、销量与占比按已入库范围；行业同比和份额变化按两期均有记录的相同类目-月份-平台集合计算，不补零。增长入选仍须完整年度。</p>`;
}
function reconcileNote(c) {
  return c.cr5 == null
    ? `<span class="warning">待对账${Number.isFinite(c.coverage) ? " · 品牌/行业 " + pct(c.coverage) : ""}</span>`
    : "";
}
function lineChart(points, label, format = money) {
  const values = points.map((p) => p.v).filter(Number.isFinite);
  if (!values.length) return '<p class="empty">没有完整可比月份</p>';
  const w = 620,
    h = 245,
    L = 65,
    R = 20,
    T = 20,
    B = 38,
    min = Math.min(0, ...values),
    max = Math.max(...values, 1),
    range = max - min || 1;
  const x = (i) => L + (i * (w - L - R)) / Math.max(points.length - 1, 1),
    y = (v) => h - B - ((v - min) / range) * (h - T - B);
  let path = "",
    on = false;
  points.forEach((p, i) => {
    if (p.v == null) {
      on = false;
      return;
    }
    path += (on ? "L" : "M") + x(i).toFixed(1) + "," + y(p.v).toFixed(1);
    on = true;
  });
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>`;
  for (let j = 0; j < 4; j++) {
    const v = min + (range * j) / 3;
    svg += `<line class="grid" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`;
  }
  svg += `<path class="line" d="${path}"/>`;
  points.forEach((p, i) => {
    if (p.v != null)
      svg += `<circle class="point" cx="${x(i)}" cy="${y(p.v)}" r="3"><title>${esc(p.label)}：${format(p.v)}</title></circle>`;
    if (
      i === 0 ||
      i === points.length - 1 ||
      i % Math.ceil(points.length / 5) === 0
    )
      svg += `<text x="${x(i)}" y="${h - 12}" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${esc(p.label)}</text>`;
  });
  return `<div class="chart">${svg}</svg></div>`;
}
function barsChart(rows, label, format = money) {
  const max = Math.max(...rows.map((r) => r.v ?? 0), 1),
    w = 600,
    lh = 32,
    h = rows.length * lh + 25;
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${rows.map((r, i) => `<text x="110" y="${i * lh + 20}" text-anchor="end">${esc(r.name)}</text><rect x="120" y="${i * lh + 7}" height="17" width="${Math.max(0, ((r.v || 0) / max) * 350)}" fill="var(--accent)" opacity=".6"/><text x="${130 + Math.max(0, ((r.v || 0) / max) * 350)}" y="${i * lh + 20}">${format(r.v)}</text>`).join("")}</svg></div>`;
}
function addBars() {
  paginateTables();
  document.querySelectorAll("table").forEach((table) => {
    const cells = [...table.querySelectorAll("td[data-value]")],
      cols = new Map();
    for (const c of cells) {
      const i = c.cellIndex;
      if (!cols.has(i)) cols.set(i, []);
      cols.get(i).push(c);
    }
    for (const list of cols.values()) {
      const max = Math.max(...list.map((c) => Math.abs(+c.dataset.value)), 0);
      for (const c of list) {
        const v = +c.dataset.value,
          s = c.dataset.signed === "true",
          width = max ? (Math.abs(v) / max) * (s ? 46 : 94) : 0,
          left = s ? (v < 0 ? 50 - width : 50) : 3;
        c.insertAdjacentHTML(
          "afterbegin",
          `${s ? '<span class="zero" aria-hidden="true"></span>' : ""}<span class="fill ${s ? (v < 0 ? "negative" : "positive") : ""}" style="left:${left}%;width:${width}%" aria-hidden="true"></span>`,
        );
      }
    }
  });
}
function syncControls() {
  const p = period();
  $("start").value = ym(p.start);
  $("end").value = ym(S.end);
  $("mode").value = S.mode;
  $("start").disabled = S.mode !== "custom";
  $("start").min = ym(manifest.first);
  $("start").max = ym(S.end);
  $("end").min = ym(manifest.first);
  $("end").max = ym(manifest.last);
  $("nav").innerHTML = views
    .map(
      ([k, n]) =>
        `<button data-view="${k}" class="${S.view === k ? "active" : ""}" aria-current="${S.view === k ? "page" : "false"}">${n}</button>`,
    )
    .join("");
  $("platforms").innerHTML = PLATFORMS.map(
    (p, i) =>
      `<label><input type="checkbox" data-plat="${i}" ${S.plats.includes(i) ? "checked" : ""}>${p}</label>`,
  ).join("");
  $("category-button").textContent =
    S.cats === null ? "全部类目 · 分级多选" : `已选 ${ids().length} 个三级类目`;
  const y = lastFullYear(S.end);
  $("range").textContent =
    `久谦 · GMV（退后）｜当前统计 ${ym(p.start)}—${ym(S.end)}${S.mode === "years" ? "（历年表逐年展示）" : ""}｜${S.plats.map((p) => PLATFORMS[p]).join(" / ") || "未选择平台"}｜数据截至 ${ym(manifest.last)}｜增长判断 ${y - 2}—${y}`;
}
function picker() {
  const tree = $("category-tree"),
    scroll = tree.scrollTop,
    opened = new Set(
      [...tree.querySelectorAll("details[open]")].map((e) => e.dataset.node),
    ),
    active = document.activeElement,
    key = active?.dataset.cat || active?.dataset.path;
  const term = $("cat-search").value.trim().toLowerCase(),
    selected = new Set(ids());
  let html = "";
  for (const one of [...new Set(categories.map((c) => c.path[0]))]) {
    const a = categories.filter(
      (c) =>
        c.path[0] === one &&
        (!term || c.path.join("/").toLowerCase().includes(term)),
    );
    if (!a.length) continue;
    const path = JSON.stringify([one]);
    html += `<details data-node="${esc(path)}" ${term || opened.has(path) ? "open" : ""}><summary><input aria-label="选择${esc(one)}" type="checkbox" data-path="${esc(path)}" ${a.every((c) => selected.has(c.id)) ? "checked" : ""}> ${esc(one)} <small>${a.length}</small></summary>`;
    for (const two of [...new Set(a.map((c) => c.path[1]))]) {
      const b = a.filter((c) => c.path[1] === two);
      html += `<details class="level2" data-node="${esc(JSON.stringify([one, two]))}" ${term || opened.has(JSON.stringify([one, two])) ? "open" : ""}><summary><input aria-label="选择${esc(two)}" type="checkbox" data-path="${esc(JSON.stringify([one, two]))}" ${b.every((c) => selected.has(c.id)) ? "checked" : ""}> ${esc(two)}</summary><div class="level3">${b.map((c) => `<label><input type="checkbox" data-cat="${c.id}" ${selected.has(c.id) ? "checked" : ""}>${esc(c.path[2])}</label>`).join("")}</div></details>`;
    }
    html += "</details>";
  }
  tree.innerHTML = html || "<p>无匹配类目</p>";
  for (const input of tree.querySelectorAll("[data-path]")) {
    const path = JSON.parse(input.dataset.path),
      all = categories.filter((c) => path.every((v, i) => c.path[i] === v));
    input.checked = all.every((c) => selected.has(c.id));
    input.indeterminate = !input.checked && all.some((c) => selected.has(c.id));
  }
  tree.scrollTop = scroll;
  if (key)
    [...tree.querySelectorAll("input")]
      .find((e) => (e.dataset.cat || e.dataset.path) === key)
      ?.focus({ preventScroll: true });
}
function treeTable() {
  const selected = ids(),
    cats = selected.map((id) => catMap.get(id)),
    total = totals(),
    prev = prevTotals(),
    shared = comparable();
  let rows = "",
    exports = [];
  function add(path, list, depth) {
    const idList = list.map((c) => c.id),
      t = totals(idList),
      p = prevTotals(idList),
      c = comparable(idList),
      growth = yoy(c.cur.g, c.prev.g),
      share = ratio(t.g, total.g),
      pairedShare = ratio(c.cur.g, shared.cur.g),
      share0 = ratio(c.prev.g, shared.prev.g),
      aspChange = c.qtyValid
        ? yoy(ratio(c.cur.g, c.cur.q), ratio(c.prev.g, c.prev.q))
        : null,
      price = t.qtyValid ? ratio(t.g, t.q) : null,
      price0 = p.qtyValid ? ratio(p.g, p.q) : null,
      key = JSON.stringify(path),
      opened = S.expanded.includes(key),
      mix =
        t.qtyValid && t.q > 0
          ? t.byPlat.map((x) => ({ p: x.p, v: x.q / t.q }))
          : [];
    const label = path.at(-1),
      platText =
        mix.map((x) => PLATFORMS[x.p] + " " + pct(x.v)).join(" / ") || "缺失";
    rows += `<tr class="depth${depth}"><td>${depth < 2 ? `<button class="treebtn" data-expand="${esc(key)}" aria-expanded="${opened}">${opened ? "▾" : "▸"} ${esc(label)}</button>` : esc(label)} ${!t.complete ? '<span class="tag">覆盖不全</span>' : ""}<br><small>${compCoverage(c, t, p)}</small></td><td>${money(t.g)}</td>${cell(growth, delta, true)}<td>${pct(share)}</td>${cell(pairedShare != null && share0 != null ? pairedShare - share0 : null, (v) => delta(v, true), true)}<td>${num(t.qtyValid ? t.q / 1e4 : null)}</td><td>${price == null ? "—" : "¥" + num(price)}</td>${cell(aspChange, delta, true)}<td><span class="mix">${mix.map((x) => `<i style="width:${x.v * 100}%;background:var(--p${x.p})"></i>`).join("")}</span>${mix.map((x) => `<span class="platform-value" style="color:var(--p${x.p})" title="${PLATFORMS[x.p]}">${pct(x.v)}</span>`).join(" / ") || "缺失"}</td><td><button data-detail="${esc(key)}">类目详情</button></td></tr>`;
    exports.push([
      path.join(" / "),
      t.g,
      growth,
      share,
      pairedShare != null && share0 != null ? pairedShare - share0 : null,
      t.qtyValid ? t.q : null,
      price,
      aspChange,
      platText,
      "类目大盘",
    ]);
    if (opened && depth < 2) {
      for (const next of [...new Set(list.map((c) => c.path[depth + 1]))])
        add(
          [...path, next],
          list.filter((c) => c.path[depth + 1] === next),
          depth + 1,
        );
    }
  }
  for (const one of [...new Set(cats.map((c) => c.path[0]))])
    add(
      [one],
      cats.filter((c) => c.path[0] === one),
      0,
    );
  return section(
    "行业结构",
    "默认一级，展开二级、三级；平台占比为销量占比，数据条按当前结果比较",
    completeNote(total) +
      table(
        "industry-table",
        [
          "一级 / 二级 / 三级类目",
          "GMV（退后）",
          "同比（可比）",
          "占比（已入库）",
          "占比变化（可比）",
          "销量（万件）",
          "件均价",
          "件均价同比（可比）",
          `平台销量占比<br><span class="platform-legend">${S.plats.map((p) => `<span><i style="background:var(--p${p})"></i>${PLATFORMS[p]}</span>`).join(" ")}</span>`,
          "详情",
        ],
        rows,
        exports,
      ),
    exportButton("industry-table"),
  );
}
function overviewYears() {
  if (S.mode !== "years") return "";
  const ps = periods(),
    groups = [...new Set(ids().map((id) => catMap.get(id).path[0]))];
  const rows = groups
    .map((name) => {
      const set = ids().filter((id) => catMap.get(id).path[0] === name);
      return (
        "<tr><td>" +
        esc(name) +
        "</td>" +
        ps
          .map((P) => {
            const a = totals(set, P.start, P.end),
              b = prevTotals(set, P.start, P.end),
              c = comparable(set, P.start, P.end);
            return (
              "<td>" +
              money(a.g) +
              "</td><td>" +
              delta(yoy(c.cur.g, c.prev.g)) +
              "</td>"
            );
          })
          .join("") +
        "</tr>"
      );
    })
    .join("");
  return section(
    "一级行业历年比较",
    "各年独立统计，当年为年累计；不完整年度不外推全年",
    table(
      "overview-years",
      [
        "一级类目",
        ...ps.flatMap((p) => [
          p.label + " GMV（退后）",
          p.label + " 同比（可比）",
        ]),
      ],
      rows,
    ),
  );
}
function matrixHTML(metrics) {
  const pool = metrics.filter((r) => r.band != null && (!S.only || r.eligible));
  let html =
    '<div class="column">增长档位 ↓ / 年规模 →</div>' +
    BANDS.map((n) => `<div class="column">${n}</div>`).join("");
  for (const group of [3, 2, 1, 0]) {
    html += `<div class="axis">${GROWTH[group]}<small>${["三个年度同比均＜0", "其余可判定情况", "三年均增长 · CAGR＜20%", "三年均增长 · CAGR≥20%"][group]}</small></div>`;
    for (let band = 0; band < 6; band++) {
      const a = pool
        .filter((r) => r.growth.group === group && r.band === band)
        .sort((a, b) => b.annual.g - a.annual.g);
      html += `<button class="${a.length ? "has" : ""}" data-matrix="${group},${band}" aria-pressed="${S.matrix?.[0] === group && S.matrix?.[1] === band}"><b>${a.length}</b><small>${
        a
          .slice(0, 4)
          .map((r) => esc(r.path[2]))
          .join(" · ") || "无符合类目"
      }${a.length > 4 ? " · 查看全部 →" : ""}</small></button>`;
    }
  }
  return `<div class="scroll"><div class="matrix">${html}</div></div>`;
}
function candidateRows(metrics) {
  let rows = metrics.filter(
    (r) =>
      r.band !== null && r.growth.group !== null && (!S.only || r.eligible),
  );
  if (S.matrix)
    rows = rows.filter(
      (r) => r.growth.group === S.matrix[0] && r.band === S.matrix[1],
    );
  if (S.search) rows = rows.filter((r) => r.path.join("/").includes(S.search));
  const get = (r) =>
    S.sort === "y"
      ? yoy(r.annual.g, r.annualPrev.g)
      : S.sort === "cagr"
        ? r.growth.cagr
        : r.annual.g;
  return rows.sort(
    (a, b) =>
      (S.desc ? -1 : 1) * ((get(a) ?? -Infinity) - (get(b) ?? -Infinity)),
  );
}
function summaryRanks(s) {
  return [
    ...s.top.map(([name, g]) => ({ name, g })),
    {
      name: "其他 Other",
      g: Math.max(0, s.total - s.top.reduce((n, r) => n + r[1], 0)),
    },
  ];
}
function candidateTable(rows, brandData) {
  const start = S.page * 10,
    part = rows.slice(start, start + 10),
    P = period(),
    brandMap = new Map(
      (brandData || []).map((r) => [r.id, r.summary || r.rows]),
    );
  let ex = [];
  const html = part
    .map((r) => {
      const b = brandMap.get(r.id);
      const c = b
          ? concentration(
              b.cur
                ? summaryRanks(b.cur)
                : brandRank(b, S.plats, shift(S.end, -11), S.end),
              r.annual.g,
              r.annual.complete,
            )
          : null,
        c0 = b
          ? concentration(
              b.prev
                ? summaryRanks(b.prev)
                : brandRank(b, S.plats, shift(S.end, -23), shift(S.end, -12)),
              r.annualPrev.g,
              r.annualPrev.complete,
            )
          : null,
        crdiff = c?.cr5 != null && c0?.cr5 != null ? c.cr5 - c0.cr5 : null,
        annY =
          r.annual.complete && r.annualPrev.complete
            ? yoy(r.annual.g, r.annualPrev.g)
            : null;
      ex.push([
        r.path.join("/"),
        r.annual.g,
        annY,
        BANDS[r.band],
        GROWTH[r.growth.group],
        r.growth.reason,
        ...r.growth.ys,
        r.growth.cagr,
        c?.cr5,
        crdiff,
        c?.top.map((b) => b.name + " " + pct(b.share)).join("；"),
        r.cur.g,
        "",
      ]);
      return `<tr><td><button class="link" data-detail="${esc(JSON.stringify(r.path))}">${esc(r.path[2])}</button><br><small>${esc(r.path.slice(0, 2).join(" / "))}</small></td>${cell(r.annual.g, money)}${cell(annY, delta, true)}<td>${BANDS[r.band]}</td><td>${GROWTH[r.growth.group]}<br><span class="tag">${r.growth.reason}</span></td>${r.growth.ys.map((y) => `<td>${delta(y)}</td>`).join("")}${cell(r.growth.cagr, delta, true)}<td>${c ? pct(c.cr5) : "加载中…"}${c && c.cr5 == null ? "<br>" + reconcileNote(c) : c && Math.abs(c.coverage - 1) > 0.01 ? `<br><small>品牌/行业 ${pct(c.coverage)}</small>` : ""}</td>${cell(crdiff, (v) => delta(v, true), true)}<td>${c?.top.length ? c.top.map((b) => esc(b.name) + " " + pct(b.share)).join("<br>") : b ? "—" : "加载中…"}</td><td>${money(r.cur.g)}</td><td><button data-detail="${esc(JSON.stringify(r.path))}">类目详情</button></td></tr>`;
    })
    .join("");
  const years = annualRange(S.end).slice(1);
  return (
    table(
      "growth-table",
      [
        "三级类目 / 归属",
        "年GMV（退后）",
        "年GMV（退后）同比",
        "规模档",
        "增长档位 / 入选依据",
        ...years.map((y) => y + "同比"),
        "三年CAGR",
        "CR5",
        "CR5同比变化",
        "TOP3品牌 / 市占率<br><small>品牌表口径</small>",
        "所选时段GMV（退后）",
        "详情",
      ],
      html,
      ex,
    ) +
    `<div class="pagination"><small>共 ${rows.length} 项 · 当前 ${rows.length ? start + 1 : 0}—${Math.min(start + 10, rows.length)}；CSV导出当前页</small><button data-page="-1" ${S.page === 0 ? "disabled" : ""}>上一页</button><button data-page="1" ${start + 10 >= rows.length ? "disabled" : ""}>下一页</button></div>`
  );
}
async function overview(t) {
  const metrics = await calcMetricsAsync();
  if (t !== token) return;
  const rows = candidateRows(metrics);
  S.page = Math.min(S.page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  const insufficient = metrics.filter((r) => r.growth.group === null).length;
  const y = lastFullYear(S.end);
  $("main").innerHTML =
    treeTable() +
    overviewYears() +
    section(
      "规模上的增长品类",
      `年GMV（退后）≥1亿；连续三年正增长，或三年中任一年同比＞50%`,
      `<p class="note">年规模：${ym(shift(S.end, -11))}—${ym(S.end)}　增长判断：${y - 2} / ${y - 1} / ${y}　${insufficient} 个类目历史不足或不可比，不强行归档。</p>${matrixHTML(metrics)}<p class="note">波动档可能因历史高速增长入选，不能视作持续增长。点击格子联动下方明细；年规模不随单月或年累计窗口缩短。</p><div class="section-head subhead"><div><h3>${S.only ? "增长品类概览" : "规模类目概览"}</h3><span class="scope">${S.matrix ? GROWTH[S.matrix[0]] + " / " + BANDS[S.matrix[1]] : "全部增长档 / 全部规模档"} · ${rows.length} 个三级类目</span></div><div><button data-action="clear-matrix" ${!S.matrix ? "disabled" : ""}>取消格子筛选</button> ${exportButton("growth-table")}</div></div><div class="toolbar"><label>排序 <select id="growth-sort"><option value="g" ${S.sort === "g" ? "selected" : ""}>年GMV（退后）</option><option value="y" ${S.sort === "y" ? "selected" : ""}>年同比</option><option value="cagr" ${S.sort === "cagr" ? "selected" : ""}>三年CAGR</option></select></label><input id="growth-search" type="search" value="${esc(S.search)}" placeholder="筛选结果中的类目"><button data-action="growth-search">搜索</button></div><div id="growth-results">${candidateTable(rows)}</div>`,
      `<label><input id="only-growth" type="checkbox" ${S.only ? "checked" : ""}>只看入选增长品类</label>`,
    );
  addBars();
  const part = rows.slice(S.page * 10, S.page * 10 + 10);
  try {
    let data;
    const insightPath = manifest.insights?.[S.end];
    if (insightPath) {
      let summary = insightCache.get(S.end);
      if (!summary) {
        summary =
          t === 1 && initialInsightPromise
            ? await initialInsightPromise
            : await jsonFile("./data/" + insightPath, activeController.signal);
        insightCache.set(S.end, summary);
        while (insightCache.size > 3)
          insightCache.delete(insightCache.keys().next().value);
      }
      const mask = S.plats.reduce((a, p) => a | (1 << p), 0);
      data = part.map((r) => ({
        id: r.id,
        summary: summary[r.id]?.[mask] || {
          cur: { total: 0, top: [] },
          prev: { total: 0, top: [] },
        },
      }));
    } else {
      data = await loadMany(
        "brand",
        part.map((r) => r.id),
        t,
      );
    }
    if (t !== token) return;
    $("growth-results").innerHTML = candidateTable(rows, data);
    addBarsToNew();
    paginateTables();
  } catch (e) {
    if (t === token) {
      toast(e.message);
      const box = $("growth-results");
      box.insertAdjacentHTML(
        "afterbegin",
        '<p class="warning">品牌数据加载失败，可刷新重试；不会以零代替。</p>',
      );
    }
  }
}
function addBarsToNew() {
  document
    .querySelectorAll(".databar .fill,.databar .zero")
    .forEach((e) => e.remove());
  addBars();
}
function platformTable(t, p) {
  const rows = t.byPlat
    .map((a) => {
      const b = p.byPlat.find((x) => x.p === a.p),
        c = comparable(ids(), period().start, S.end, [a.p]);
      return `<tr><td>${PLATFORMS[a.p]}</td><td>${money(a.present ? a.g : null)}</td>${cell(yoy(c.cur.g, c.prev.g), delta, true)}<td>${pct(ratio(a.g, t.g))}</td><td>${num(t.qtyValid ? a.q : null)}</td><td>${t.qtyValid ? pct(ratio(a.q, t.q)) : "—"}</td><td>${a.present > 0 && t.qtyValid ? "¥" + num(ratio(a.g, a.q)) : "—"}</td></tr>`;
    })
    .join("");
  return table(
    "platform-table",
    [
      "平台",
      "GMV（退后）",
      "同比（可比）",
      "金额占比",
      "销量",
      "销量占比",
      "件均价",
    ],
    rows,
  );
}
function loadingDetails(label) {
  $("main").innerHTML = section(
    label,
    "按当前所选类目、时段和平台加载明细",
    '<p class="loading" id="load-progress">正在加载数据分片…</p>',
  );
}
function priceSum(parts, P, brand = null) {
  const bins = new Map();
  for (const { rows } of parts)
    for (const r of rows) {
      if (
        r[0] < P.start ||
        r[0] > P.end ||
        !S.plats.includes(r[1]) ||
        (brand != null && r[2] !== brand)
      )
        continue;
      const off = brand != null ? 1 : 0,
        b = r[2 + off],
        v = bins.get(b) || { g: 0, q: 0 };
      v.g += r[3 + off] ?? 0;
      v.q += r[4 + off] ?? 0;
      bins.set(b, v);
    }
  return bins;
}
function method() {
  const a = manifest.audit || {};
  $("main").innerHTML = section(
    "口径与数据",
    "真实来源、覆盖范围、校验与版本记录",
    `<div class="method-body"><p>数据版本 <code>${esc(manifest.version)}</code> · 数据截至 ${ym(manifest.last)} · 数据生成 ${esc(manifest.built)}（北京时间）。部署成功时间与提交见 GitHub 发布记录。</p><p>当前发布覆盖 ${categories.length} 个有效久谦三级类目；类别只按久谦完整一级 / 二级 / 三级路径合并。未通过校验或无完整路径的记录不进入分析。</p><details class="method" open><summary>来源与覆盖</summary>${table(
      "sources",
      [
        "来源表",
        "用途",
        "月份范围",
        "最近入库时间",
        "本次采集完成（北京时间）",
      ],
      Object.entries(
        Object.values(manifest.sources || {}).reduce((a, v) => {
          const key = v.table;
          if (a[key]) {
            a[key].use += "、" + v.use;
            if (v.collected > a[key].collected) a[key].collected = v.collected;
          } else a[key] = { ...v };
          return a;
        }, {}),
      )
        .map(
          ([k, v]) =>
            `<tr><td>${esc(v.table || k)}</td><td>${esc(v.use || "")}</td><td>${ym(v.first)}—${ym(v.last)}</td><td>${esc(v.loaded)}</td><td>${esc(v.collected)}</td></tr>`,
        )
        .join(""),
    )}</details><details class="method" open><summary>指标和增长规则</summary><ul><li>GMV（退后）使用源表 gmv，单位为人民币元；页面按金额自动显示万/亿，CSV统一导出元。延续原看板的久谦退后口径；表结构没有独立退款字段，不通过退前减退款重新推算。</li><li>件均价＝汇总GMV（退后）÷汇总销量，不能平均商品单价。份额变化及 CR5 同比变化使用百分点 pp。</li><li>增长档：三个完整年度同比均负＝持续下滑；均正且三年 CAGR＜20%＝持续中低速增长；均正且 CAGR≥20%＝持续高速增长；其余＝持平或波动增长/回落。</li><li>三年 CAGR＝最后一年金额÷三年前金额的立方根−1。判断三个年度同比需要四个完整年度；任何必需月份、平台、基期缺失则暂无法判断。</li><li>入选增长品类：年GMV（退后）≥1亿元，并满足连续三年同比均＞0，或近三个完整年度至少一年同比严格＞50%。</li><li>年规模采用截止月向前12个月；同比再向前移12个月。单月、年累计和自定义时段影响普通分析，矩阵始终保持完整年规模；年份判断以截止月前最近完整年度为准。</li><li>行业占比＝当前类目已入库金额÷全局所选已入库金额；行业结构、类目大盘和历年行业同比采用两期都有记录的相同类目-月份-平台集合，份额变化也使用该共同集合，覆盖率单独列示；展开子类目不改变分母。多选按三级类目ID去重。父子级不重复累计。</li><li>CR5＝本期前5个已识别品牌金额÷当前范围品牌表汇总金额。上年独立选取前5品牌。其他 Other、无品牌和未识别品牌计入分母、不参与排名。品牌市占率与CR5使用品牌表同源分母（含未识别品牌）；不因跨表覆盖差异隐藏。覆盖不足时表示已入库品牌数据内份额，不能解释为全市场份额。品牌与行业差异另行披露。</li><li>价格带按原始 asp 划分，左闭右开；缺失及非正价格独立保留。价格带和品牌价格结构的份额分母来自商品表，不能直接套用行业表。</li><li>缺失与零值区分：无源记录不当作零。累计值可展示已入库金额并提示缺月；不完整范围不计算整体现有范围同比或年分档；行业可比同比只使用两期共同记录，并明确显示可比覆盖率。品牌未出现不推断为新品牌或真实零销售。</li></ul></details><details class="method" open><summary>本次校验结果</summary><p>${esc(a.summary || "详见数据检查文件")}</p><p>源表含负金额或负销量的聚合记录：${esc(JSON.stringify(a.negativeRows || {}))}。保留原始汇总，非正销量不计算件均价；这些记录的修订原因源表未说明。</p><p>行业原始键冲突：${a.industryConflicts ?? "—"}；映射歧义路径：${a.mappingAmbiguities ?? "—"}。事实表已带久谦路径，不通过映射表多对多关联放大金额。</p><p>品牌 / 行业对账通过：${a.brandMatched ?? "—"} / ${a.brandCompared ?? "—"} 个可比三级类目（最近12个月，全平台）。跨表差异保留作覆盖审核；品牌份额与CR5按同源品牌数据计算。</p><p>商品 / 行业对账通过：${a.priceMatched ?? "—"} / ${a.priceCompared ?? "—"}。店铺表用于汇总核验，不以店铺名推断品牌，不展示商品系列。</p></details><details class="method" open><summary>更新与发布</summary><p id="schedule-status">${esc(manifest.updateStatus || "手动更新脚本已提供，定时任务尚未启用。")}</p><ol><li>只读获取五张久谦源表；核对入库时间和月份覆盖。</li><li>形成隔离候选数据，检查精确键、类目路径、月份连续性、负值和跨表口径。</li><li>无实质变化不产生数据版本；校验失败保留线上上一成功版本。</li><li>通过检查后提交源码和聚合数据，推送 GitHub Pages，再检查正式页面与版本。</li></ol><p>所有源表缺少可用索引，当前全量聚合成本较高。首次版本采用全量快照；不把未实现的最近三个月增量更新写成已启用。</p></details><p>数据可公开访问；网站不保存数据库凭据，不由浏览器直接连接数据库。筛选状态仅存当前浏览器。</p></div>`,
  );
}
async function render() {
  analysisWorker?.postMessage({ type: "cancel" });
  for (const job of analysisJobs.values())
    job.reject(new DOMException("请求已取消", "AbortError"));
  analysisJobs.clear();
  if (token > 0) dataWorker?.postMessage({ type: "cancel" });
  activeController.abort();
  activeController = new AbortController();
  pendingFiles = new Map();
  const t = ++token;
  const renderStarted = performance.now();
  renderStartedAt = renderStarted;
  $("main").dataset.longTaskMs = "0";
  exportTables.clear();
  syncControls();
  persist();
  $("main").setAttribute("aria-busy", "true");
  if (!ids().length || !S.plats.length) {
    $("main").innerHTML =
      '<section class="panel"><p class="empty">请至少选择一个类目和一个平台。</p></section>';
    $("main").setAttribute("aria-busy", "false");
    return;
  }
  try {
    if (S.view === "overview") await overview(t);
    else if (S.view === "market") await marketReference(t);
    else if (S.view === "price") await priceReference(t);
    else if (S.view === "competition") await competitionReference(t);
    else if (S.view === "brand") await brandReference(t);
    else method();
    if (t === token) {
      $("main").setAttribute("aria-busy", "false");
      $("main").dataset.renderMs = (performance.now() - renderStarted).toFixed(
        1,
      );
      $("main").dataset.view = S.view;
    }
    if (t === token && returnState)
      $("main").insertAdjacentHTML(
        "afterbegin",
        '<div class="back"><button data-action="back">← 返回原浏览位置</button></div>',
      );
  } catch (e) {
    if (t === token)
      $("main").innerHTML = section(
        "加载未完成",
        "请检查网络后重试",
        `<p class="warning">${esc(e.message)}</p><button data-action="retry">重试</button>`,
      );
    if (t === token) $("main").setAttribute("aria-busy", "false");
  }
}
function resetLocal() {
  S.matrix = null;
  S.page = 0;
  S.price = null;
  metricsKey = null;
}
document.addEventListener("table-page", () => addBarsToNew());
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.setting) {
    S[b.dataset.setting] = b.dataset.value;
    render();
    return;
  }
  if (b.dataset.view) {
    S.view = b.dataset.view;
    window.scrollTo({ top: 0 });
    location.hash = S.view;
    render();
  }
  if (b.dataset.expand) {
    const k = b.dataset.expand;
    S.expanded = S.expanded.includes(k)
      ? S.expanded.filter((x) => x !== k)
      : [...S.expanded, k];
    render();
  }
  if (b.dataset.matrix) {
    S.matrix = b.dataset.matrix.split(",").map(Number);
    S.page = 0;
    render();
  }
  if (b.dataset.page) {
    S.page += +b.dataset.page;
    render();
  }
  if (b.dataset.detail) {
    returnState = { state: structuredClone(S), scroll: window.scrollY };
    const path = JSON.parse(b.dataset.detail);
    S.cats = categories
      .filter((c) => path.every((p, i) => c.path[i] === p))
      .map((c) => c.id);
    S.view = "market";
    resetLocal();
    location.hash = "market";
    render();
    window.scrollTo({ top: 0 });
  }
  if (b.dataset.brand) {
    S.brand = b.dataset.brand;
    S.view = "brand";
    location.hash = "brand";
    render();
  }
  if (b.dataset.price !== undefined) {
    S.price = +b.dataset.price;
    render();
  }
  if (b.dataset.export) {
    const rows = exportTables.get(b.dataset.export);
    if (!rows) return toast("数据仍在加载，请稍后导出");
    const scope = [
      ["数据版本", manifest.version],
      ["数据源", "久谦"],
      ["金额口径", "GMV（退后）"],
      ["单位", "金额为人民币元；销量为件；件均价为元/件"],
      ["统计范围", ym(period().start) + "—" + ym(S.end)],
      ["平台", S.plats.map((p) => PLATFORMS[p]).join("/")],
      ["所选三级类目数", ids().length],
      [
        "行业同比口径",
        "两期共同类目-月份-平台记录；未配对记录不补零；增长矩阵仍要求完整年度",
      ],
      ["百分比", "导出比例为小数；份额变化为比例差，乘100为pp"],
      [],
    ];
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([csv([...scope, ...rows])], {
          type: "text/csv;charset=utf-8",
        }),
      );
    a.href = url;
    a.download = `久谦_${b.dataset.export}_${period().start}-${S.end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`已导出当前表 ${rows.length - 1} 行至浏览器下载目录`);
  }
  const action = b.dataset.action;
  if (action === "clear-matrix") {
    S.matrix = null;
    S.page = 0;
    render();
  }
  if (action === "clear-price") {
    S.price = null;
    render();
  }
  if (action === "growth-search") {
    S.search = $("growth-search").value.trim();
    S.page = 0;
    render();
  }
  if (action === "brand-search") {
    S.brandSearch = $("brand-search").value.trim();
    render();
  }
  if (action === "retry") location.reload();
  if (action === "back" && returnState) {
    const r = returnState;
    returnState = null;
    S = r.state;
    metricsKey = null;
    location.hash = S.view;
    render().then(() => window.scrollTo({ top: r.scroll }));
  }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "mode") {
    const previous = period();
    S.mode = el.value;
    S.start = S.mode === "custom" ? previous.start : period().start;
    resetLocal();
    render();
  }
  if (el.id === "start" || el.id === "end") {
    const v = +el.value.replace("-", "");
    if (
      !Number.isFinite(v) ||
      v < manifest.first ||
      v > manifest.last ||
      (el.id === "start" && v > S.end)
    ) {
      toast("请选择数据覆盖内的有效月份");
      syncControls();
      return;
    }
    S[el.id] = v;
    if (S.start > S.end) S.start = S.end;
    resetLocal();
    render();
  }
  if (el.dataset.plat !== undefined) {
    const p = +el.dataset.plat;
    S.plats = el.checked
      ? [...S.plats, p].sort()
      : S.plats.filter((x) => x !== p);
    resetLocal();
    render();
  }
  if (el.id === "only-growth") {
    S.only = el.checked;
    S.page = 0;
    S.matrix = null;
    render();
  }
  if (el.id === "growth-sort") {
    S.sort = el.value;
    S.page = 0;
    render();
  }
  if (el.id === "brand-compare") {
    S.compare = el.value;
    render();
  }
  if (el.id === "brand-select") {
    S.brand = el.value;
    render();
  }
  if (el.dataset.cat || el.dataset.path) {
    const selected = new Set(ids());
    let set = el.dataset.cat
      ? [el.dataset.cat]
      : categories
          .filter((c) =>
            JSON.parse(el.dataset.path).every((v, i) => c.path[i] === v),
          )
          .map((c) => c.id);
    set.forEach((id) => (el.checked ? selected.add(id) : selected.delete(id)));
    S.cats = selected.size === categories.length ? null : [...selected];
    picker();
    $("category-button").textContent = `已选 ${selected.size} 个三级类目`;
  }
});
$("category-button").onclick = () => {
  const hidden = !$("category-picker").hidden;
  $("category-picker").hidden = hidden;
  $("category-button").setAttribute("aria-expanded", !hidden);
  if (!hidden) picker();
};
let pickerTimer;
$("cat-search").oninput = () => {
  clearTimeout(pickerTimer);
  pickerTimer = setTimeout(picker, 100);
};
$("cat-all").onclick = () => {
  S.cats = null;
  picker();
};
$("cat-clear").onclick = () => {
  S.cats = [];
  picker();
};
$("cat-done").onclick = () => {
  $("category-picker").hidden = true;
  $("category-button").setAttribute("aria-expanded", "false");
  resetLocal();
  render();
};
$("reset").onclick = () => {
  S.cats = null;
  S.plats = [0, 1, 2];
  S.mode = "mat";
  S.end = manifest.last;
  S.start = shift(S.end, -11);
  S.search = "";
  S.expanded = [];
  returnState = null;
  resetLocal();
  render();
};
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (views.some((x) => x[0] === v) && v !== S.view) {
    S.view = v;
    render();
  }
});
function setupWorker() {
  if (!globalThis.Worker) return;
  metricsWorker = new Worker(
    new URL("./lib/metrics-worker.js?v=" + VERSION, import.meta.url),
    { type: "module" },
  );
  metricsWorker.onmessage = (e) => {
    const job = workerJobs.get(e.data.id);
    if (job) {
      workerJobs.delete(e.data.id);
      e.data.error ? job.reject(Error(e.data.error)) : job.resolve(e.data.rows);
    }
  };
  metricsWorker.onerror = () => {
    for (const job of workerJobs.values())
      job.reject(Error("指标计算线程加载失败，请刷新重试"));
    workerJobs.clear();
    metricsWorker.terminate();
    metricsWorker = null;
  };
}
async function calcMetricsAsync() {
  if (!metricsWorker) return calcMetrics();
  const P = period(),
    key = JSON.stringify([ids(), S.plats, P]);
  if (key === metricsKey) return metricsMemo;
  const id = ++workerSeq;
  const rows = await new Promise((resolve, reject) => {
    workerJobs.set(id, { resolve, reject });
    metricsWorker.postMessage({
      type: "compute",
      id,
      ids: ids(),
      plats: S.plats,
      start: P.start,
      end: P.end,
    });
  });
  const out = rows.map((r) => ({ ...r, ...catMap.get(r.id) }));
  metricsKey = key;
  metricsMemo = out;
  return out;
}
function setupDataWorker() {
  if (!globalThis.Worker) return;
  dataWorker = new Worker(
    new URL("./lib/data-worker.js?v=" + VERSION, import.meta.url),
    {
      type: "module",
    },
  );
  dataWorker.onmessage = ({ data: m }) => {
    const job = dataJobs.get(m.id);
    if (job) {
      dataJobs.delete(m.id);
      m.error ? job.reject(Error(m.error)) : job.resolve(m.result);
    }
  };
  dataWorker.onerror = () => {
    for (const job of dataJobs.values())
      job.reject(Error("数据线程加载失败，请刷新重试"));
    dataJobs.clear();
    dataWorker.terminate();
    dataWorker = null;
  };
}
async function boot() {
  const bootStarted = performance.now();
  try {
    setupDataWorker();
    setupAnalysisWorker();
    setupWorker();
    manifest = await jsonFile("./data/manifest.json?version=" + Date.now());
    const initialEnd = Math.min(
      manifest.last,
      Math.max(manifest.first, S.end || manifest.last),
    );
    if (
      (location.hash.slice(1) || S.view) === "overview" &&
      manifest.insights?.[initialEnd]
    ) {
      initialInsightPromise = jsonFile(
        "./data/" + manifest.insights[initialEnd],
      ).then((data) => {
        insightCache.set(initialEnd, data);
        return data;
      });
      initialInsightPromise.catch(() => {});
    }
    industry = await jsonFile("./data/" + manifest.industry);
    categories = industry.categories;
    catMap = new Map(categories.map((c) => [c.id, c]));
    index = indexIndustry(industry.rows);
    metricsWorker?.postMessage({ type: "init", rows: industry.rows });
    S.end = Math.min(
      manifest.last,
      Math.max(manifest.first, S.end || manifest.last),
    );
    S.start = Math.min(S.end, Math.max(manifest.first, S.start));
    S.cats = S.cats === null ? null : S.cats.filter((id) => catMap.has(id));
    const v = location.hash.slice(1);
    if (views.some((x) => x[0] === v)) S.view = v;
    $("footer").textContent =
      `看板 V${VERSION} · 数据 ${manifest.version} · ${categories.length}个三级类目 · 最近成功数据生成 ${manifest.built}（北京时间）`;
    $("controls").removeAttribute("inert");
    document.title = `久谦·行业品类品牌趋势看板V${VERSION}`;
    document.querySelector("h1 span").textContent = `V${VERSION}`;
    if (window.requestAnimationFrame && globalThis.MutationObserver)
      installViewportTableHeaders();
    await render();
    document.body.dataset.initialDataMs = (
      performance.now() - bootStarted
    ).toFixed(1);
  } catch (e) {
    $("main").innerHTML =
      `<section class="panel"><h2>数据加载失败</h2><p>${esc(e.message)}</p><button onclick="location.reload()">刷新重试</button></section>`;
  }
}
function setupAnalysisWorker() {
  if (!globalThis.Worker) return;
  analysisWorker = new Worker(
    new URL("./lib/analysis-worker.js?v=" + VERSION, import.meta.url),
    { type: "module" },
  );
  analysisWorker.onmessage = ({ data: m }) => {
    const job = analysisJobs.get(m.id);
    if (!job) return;
    if (m.progress != null) {
      const e =
        $("load-progress") ||
        $("brand-load-progress") ||
        $("brand-price-progress");
      if (e)
        e.textContent = `正在加载与计算 ${m.progress} / ${m.total} 个数据分片…`;
      return;
    }
    analysisJobs.delete(m.id);
    m.error ? job.reject(Error(m.error)) : job.resolve(m.result);
  };
  analysisWorker.onerror = () => {
    for (const job of analysisJobs.values())
      job.reject(Error("分析线程加载失败，请刷新重试"));
    analysisJobs.clear();
    analysisWorker.terminate();
    analysisWorker = null;
  };
}
function sourcePlan(kind, list, raw = false, history = false) {
  const remaining = new Set(list),
    chosen = [];
  if (!raw) {
    const scopes = Object.entries(manifest.scopes || {}).sort(
      (a, b) => b[1].ids.length - a[1].ids.length,
    );
    for (const [key, s] of scopes)
      if (
        manifest.files[kind]?.[key] &&
        s.ids.every((id) => remaining.has(id))
      ) {
        chosen.push(key);
        s.ids.forEach((id) => remaining.delete(id));
      }
  }
  chosen.push(...remaining);
  const P = period(),
    min = history
      ? manifest.first
      : kind === "brand"
        ? Math.min(shift(P.start, -12), shift(P.end, -23))
        : P.start;
  return chosen
    .filter((id) => manifest.files[kind]?.[id])
    .flatMap((id) => {
      const e = manifest.files[kind][id];
      return (
        Array.isArray(e)
          ? e.filter((x) => x.month >= min && x.month <= P.end)
          : [{ path: e }]
      ).map((x) => ({
        id,
        url: new URL("./data/" + x.path, location.href).href,
      }));
    });
}
async function analyze(kind, list, extra = {}, raw = false) {
  const P = period();
  if (
    kind === "price" &&
    !extra.history &&
    !extra.brand &&
    S.end === manifest.last &&
    ["mat", "ytd", "month"].includes(S.mode)
  ) {
    const selected = new Set(list),
      scope = Object.entries(manifest.scopes || {}).find(
        ([k, v]) =>
          manifest.priceLeaders?.[k] &&
          v.ids.length === selected.size &&
          v.ids.every((id) => selected.has(id)),
      );
    if (scope) {
      const key = "price|" + scope[0];
      if (!leaderCache.has(key))
        leaderCache.set(
          key,
          await jsonFile(
            "./data/" + manifest.priceLeaders[scope[0]],
            activeController.signal,
          ),
        );
      const d =
        leaderCache.get(key)[
          S.plats.reduce((s, p) => s + (1 << p), 0) +
            "|" +
            S.mode +
            "|" +
            (extra.band ?? "all")
        ];
      if (d) return d;
    }
  }

  if (
    kind === "brand" &&
    !extra.brandOnly &&
    !extra.history &&
    !extra.search &&
    S.end === manifest.last &&
    ["mat", "ytd", "month"].includes(S.mode)
  ) {
    const set = new Set(list),
      scope = Object.entries(manifest.scopes || {}).find(
        ([k, v]) =>
          manifest.leaders?.[k] &&
          v.ids.length === set.size &&
          v.ids.every((x) => set.has(x)),
      );
    if (scope) {
      const key = scope[0];
      if (!leaderCache.has(key))
        leaderCache.set(
          key,
          await jsonFile(
            "./data/" + manifest.leaders[key],
            activeController.signal,
          ),
        );
      const d =
        leaderCache.get(key)[
          S.plats.reduce((s, p) => s + (1 << p), 0) + "|" + S.mode
        ];
      if (d && (!extra.brand || d.cur.some((r) => r.name === extra.brand)))
        return d;
    }
  }
  const id = ++analysisSeq;
  return new Promise((resolve, reject) => {
    analysisJobs.set(id, { resolve, reject });
    analysisWorker.postMessage({
      type: "analyze",
      id,
      kind,
      files: sourcePlan(
        kind === "brand" ? "brand" : "brandprice",
        list,
        raw,
        extra.history,
      ),
      start: P.start,
      end: P.end,
      plats: S.plats,
      ...extra,
    });
  });
}
boot();
function kpi(label, value, sub = "", values = [], color) {
  return `<div class="kpi"><div class="k">${label}</div><div class="v">${value}</div><div class="d">${sub}</div>${values.length ? spark(values, color) : ""}</div>`;
}
function conclusion(text) {
  return `<div class="conclusion"><span class="tag">结论</span>${text}</div>`;
}
function chartFrame(html) {
  return `<div class="chart-frame">${html}</div>`;
}
async function marketReference(t) {
  const a = totals(),
    b = prevTotals(),
    c = comparable(),
    ms = months(Math.max(manifest.first, shift(S.end, -35)), S.end),
    monthly = ms.map((m) => totals(ids(), m, m));
  const tiny = monthly.slice(-13),
    g = ratio(a.g, a.q),
    gran = S.gran || "m",
    share = S.trendVal === "share";
  const buckets = [];
  ms.forEach((m, i) => {
    const key =
      gran === "q"
        ? `${Math.floor(m / 100)}Q${Math.ceil((m % 100) / 3)}`
        : gran === "y"
          ? String(Math.floor(m / 100))
          : ym(m);
    let last = buckets.at(-1);
    if (!last || last.key !== key) buckets.push((last = { key, indices: [] }));
    last.indices.push(i);
  });
  const series = S.plats.map((p) => ({
    name: PLATFORMS[p],
    color: `var(--p${p})`,
    values: buckets.map((bucket) => {
      const rows = bucket.indices
        .map((i) => monthly[i].byPlat.find((x) => x.p === p))
        .filter((x) => x?.present);
      return rows.length ? rows.reduce((v, x) => v + x.g, 0) : null;
    }),
  }));
  const growth = buckets.map((bucket) => {
    const start = ms[bucket.indices[0]],
      end = ms[bucket.indices.at(-1)],
      v = comparable(ids(), start, end);
    return yoy(v.cur.g, v.prev.g);
  });
  const scope =
    ids().length === 1
      ? catMap.get(ids()[0]).path.join(" / ")
      : `所选 ${ids().length} 个三级类目`;
  const stats =
    kpi(
      "GMV（退后）",
      money(a.g),
      "同比 " + delta(yoy(c.cur.g, c.prev.g)),
      tiny.map((x) => x.g),
    ) +
    kpi(
      "销量",
      money(a.q) + "件",
      "同比 " + delta(c.qtyValid ? yoy(c.cur.q, c.prev.q) : null),
      tiny.map((x) => x.q),
    ) +
    kpi(
      "件均价",
      "¥" + num(g),
      "同比 " +
        delta(
          c.qtyValid
            ? yoy(ratio(c.cur.g, c.cur.q), ratio(c.prev.g, c.prev.q))
            : null,
        ),
      tiny.map((x) => ratio(x.g, x.q)),
      "#7258ba",
    ) +
    '<div id="market-cr" class="kpi"><div class="k">CR5</div><p class="loading">加载品牌数据…</p></div><div id="market-top" class="kpi"><div class="k">第一品牌</div><p class="loading">加载品牌数据…</p></div>';
  const controls =
    segments("gran", gran, [
      ["m", "月度"],
      ["q", "季度"],
      ["y", "年度"],
    ]) +
    segments("trendVal", share ? "share" : "gmv", [
      ["gmv", "GMV（退后）"],
      ["share", "GMV（退后）占比"],
    ]);
  const detailRows = ids()
    .map((id) => {
      const x = totals([id]),
        z = comparable([id]);
      return { id, x, z };
    })
    .sort((a, b) => b.x.g - a.x.g);
  const detailHeaders = [
    "细分品类",
    "GMV（退后）",
    "同比（可比）",
    "占比",
    "销量",
    "件均价",
    "详情",
  ];
  const detail = table(
    "market-categories",
    detailHeaders,
    detailRows
      .map(
        ({ id, x, z }) =>
          `<tr><td>${esc(catMap.get(id).path.join(" / "))}</td>${cell(x.g, money)}${cell(yoy(z.cur.g, z.prev.g), delta, true)}${cell(ratio(x.g, a.g), pct)}<td>${num(x.q)}</td><td>¥${num(ratio(x.g, x.q))}</td><td><button data-detail="${esc(JSON.stringify(catMap.get(id).path))}">类目详情</button></td></tr>`,
      )
      .join(""),
    detailRows.map(({ id, x, z }) => [
      catMap.get(id).path.join("/"),
      x.g,
      yoy(z.cur.g, z.prev.g),
      ratio(x.g, a.g),
      x.q,
      ratio(x.g, x.q),
      "",
    ]),
  );
  $("main").innerHTML =
    conclusion(
      `${esc(scope)} ${ym(period().start)}—${ym(S.end)}，GMV（退后）<b>${money(a.g)}</b>，可比同比 <b>${delta(yoy(c.cur.g, c.prev.g))}</b>；件均价 ¥${num(g)}。`,
    ) +
    `<div class="kpis">${stats}</div>` +
    section(
      "销售趋势",
      `${gran === "m" ? "近36个月" : gran === "q" ? "季度汇总" : "年度汇总"} · 截至 ${ym(S.end)}；未满季度或年度按已选截止月，悬浮或聚焦图形查看数值`,
      chartFrame(
        seriesChart(
          buckets.map((x) => x.key),
          series,
          { percent: share, format: share ? pct : money },
        ),
      ) +
        `<h3>GMV（退后）同比</h3>` +
        chartFrame(
          seriesChart(
            buckets.map((x) => x.key),
            [{ name: "和上一年相同月份比较", values: growth }],
            { signed: true, format: pct, height: 145 },
          ),
        ),
      controls,
    ) +
    section(
      "结构",
      compCoverage(c, a, b),
      completeNote(a) +
        `<h3>平台结构</h3>${platformTable(a, b)}<div class="section-head subhead"><h3>细分品类结构</h3>${exportButton("market-categories")}</div>${detail}`,
    );
  addBars();
  const d = await analyze("brand", ids());
  if (t !== token) return;
  const cr = concentration(d.cur, a.g),
    cr0 = concentration(d.prev, b.g),
    top = cr.top[0],
    old = top ? d.prev.find((r) => r.name === top.name) : null;
  const month = d.monthly.sort((a, b) => a.month - b.month).slice(-13),
    crVals = month.map((m) => concentration(m.ranks, 1).cr5),
    topVals = month.map((m) => {
      const r = m.ranks.find((r) => r.name === top?.name);
      return r
        ? ratio(
            r.g,
            m.ranks.reduce((s, r) => s + r.g, 0),
          )
        : null;
    });
  $("market-cr").outerHTML = kpi(
    "CR5（品牌表口径）",
    pct(cr.cr5),
    "变化 " +
      delta(cr.cr5 != null && cr0.cr5 != null ? cr.cr5 - cr0.cr5 : null, true),
    crVals,
    "#7258ba",
  );
  $("market-top").outerHTML = kpi(
    "第一品牌",
    top ? `${esc(top.name)} <small>${pct(top.share)}</small>` : "—",
    "份额变化 " +
      delta(
        top && old ? top.share - ratio(old.g, cr0.denominator) : null,
        true,
      ),
    topVals,
    "#e96635",
  );
}
async function priceReference(t) {
  loadingDetails("类目价格带");
  const parts = await loadMany("price", ids(), t);
  if (t !== token) return;
  const P = period(),
    Q = { start: shift(P.start, -12), end: shift(P.end, -12) },
    cur = priceSum(parts, P),
    prev = priceSum(parts, Q),
    g = [...cur.values()].reduce((s, r) => s + r.g, 0),
    g0 = [...prev.values()].reduce((s, r) => s + r.g, 0),
    bands = [0, 1, 2, 3, 4, 5, 6, 7, 8, -1],
    name = (b) => (b < 0 ? "价格缺失 / 非正" : PRICE[b] + "元");
  const rows = bands.map((b) => ({ b, a: cur.get(b), z: prev.get(b) })),
    top = rows.filter((r) => r.a).sort((a, b) => b.a.g - a.a.g)[0];
  const migration = [];
  for (let k = 3; k >= 0; k--) {
    const start = shift(P.start, -12 * k),
      end = shift(P.end, -12 * k);
    if (start < manifest.first) continue;
    const bins = priceSum(parts, { start, end });
    migration.push({
      label: ym(start) + "—" + ym(end),
      parts: bands.map((b) => ({ name: name(b), band: b, g: bins.get(b)?.g })),
    });
  }
  const heads = [
    "价格带（元）",
    "GMV（退后）",
    "同比",
    "占比",
    "占比变化",
    "件均价",
    "第一品牌",
    "第二品牌",
  ];
  $("main").innerHTML =
    conclusion(
      top
        ? `${ym(P.start)}—${ym(P.end)} 销售额最集中的价位是 <b>${name(top.b)}</b>（占 ${pct(ratio(top.a.g, g))}）。点击价位可筛选下方品牌矩阵。`
        : "当前范围暂无价格记录",
    ) +
    section(
      "价格带占比迁移",
      "各年同期的价格带结构 · 100%堆叠 · 缺失价格单列",
      horizontalMix(migration),
    ) +
    section(
      "价格带分布",
      "份额以当前商品表汇总金额为分母；原始件均价分档，不做价格校正",
      `<p class="note">商品 / 行业金额：${pct(ratio(g, totals().g))}；两源覆盖差异不混入份额分母。</p>` +
        table(
          "price-table",
          heads,
          rows
            .map(
              ({ b, a, z }) =>
                `<tr><td><button class="link" data-price="${b}" aria-pressed="${S.price === b}">${name(b)}${S.price === b ? " ✓" : ""}</button></td>${cell(a?.g, money)}${cell(a && z ? yoy(a.g, z.g) : null, delta, true)}${cell(ratio(a?.g, g), pct)}${cell(a && z ? ratio(a.g, g) - ratio(z.g, g0) : null, (v) => delta(v, true), true)}<td>¥${num(ratio(a?.g, a?.q))}</td><td data-leader-band="${b}">加载中…</td><td data-second-band="${b}">加载中…</td></tr>`,
            )
            .join(""),
          rows.map(({ b, a, z }) => [
            name(b),
            a?.g,
            a && z ? yoy(a.g, z.g) : null,
            ratio(a?.g, g),
            a && z ? ratio(a.g, g) - ratio(z.g, g0) : null,
            ratio(a?.g, a?.q),
            null,
            null,
          ]),
        ),
      exportButton("price-table"),
    ) +
    section(
      "价格带 × 品牌",
      "每列为该价位内品牌份额，颜色越深数值越大；未识别品牌计入分母",
      `<div id="price-brand"><p class="loading" id="load-progress">正在加载品牌价格结构…</p></div>`,
      segments("heatVal", S.heatVal || "share", [
        ["share", "市占率"],
        ["gmv", "GMV（退后）"],
        ["qty", "销量"],
      ]) + `<button data-action="clear-price">取消价格带筛选</button>`,
    );
  addBars();
  const d = await analyze("price", ids(), {});
  if (t !== token) return;
  const binMap = new Map(d.bins.map((r) => [r.name, r]));
  for (const b of bands) {
    const lead =
      d.bandLeaders?.[b] ||
      d.top
        .filter((r) => r.bands[b] > 0)
        .sort((a, z) => z.bands[b] - a.bands[b]);
    for (const [attr, k] of [
      ["data-leader-band", 0],
      ["data-second-band", 1],
    ]) {
      const el = document.querySelector(`[${attr}="${b}"]`),
        r = lead[k];
      el.textContent = r
        ? `${r.name} ${pct(ratio(r.bands[b], cur.get(b)?.g))}`
        : "—";
    }
    const out = exportTables.get("price-table")?.[bands.indexOf(b) + 1];
    if (out) {
      out[6] = document.querySelector(`[data-leader-band="${b}"]`).textContent;
      out[7] = document.querySelector(`[data-second-band="${b}"]`).textContent;
    }
  }
  const matrixData =
    S.price == null ? d : await analyze("price", ids(), { band: S.price });
  if (t !== token) return;
  const shown = S.price == null ? bands : bands.filter((b) => b === S.price),
    hv = S.heatVal || "share",
    value = (r, b) =>
      hv === "gmv"
        ? r.bands[b]
        : hv === "qty"
          ? r.bandQty?.[b]
          : ratio(r.bands[b], binMap.get(b)?.g),
    fmt = hv === "share" ? pct : money;
  const leaders = matrixData.top.slice(0, 20),
    mx = Math.max(
      1,
      ...leaders.flatMap((r) => shown.map((b) => value(r, b) || 0)),
    );
  $("price-brand").innerHTML =
    table(
      "price-brand-table",
      ["品牌", ...shown.map(name)],
      leaders
        .map(
          (r) =>
            `<tr><td><button class="link" data-brand="${esc(r.name)}">${esc(r.name)}</button></td>${shown
              .map((b) => {
                const v = value(r, b);
                return `<td style="background:color-mix(in srgb,var(--accent) ${v ? 8 + Math.sqrt(v / mx) * 34 : 0}%,var(--surface))">${fmt(v)}</td>`;
              })
              .join("")}</tr>`,
        )
        .join(""),
      leaders.map((r) => [r.name, ...shown.map((b) => value(r, b))]),
    ) + exportButton("price-brand-table");
  paginateTables();
}
async function competitionReference(t) {
  loadingDetails("竞品格局");
  const d = await analyze("brand", ids());
  if (t !== token) return;
  const total = totals(),
    prior = prevTotals(),
    c = concentration(d.cur, total.g),
    c0 = concentration(d.prev, prior.g),
    known = d.cur.filter((r) => isKnown(r.name)),
    pm = new Map(d.prev.map((r) => [r.name, r])),
    lead = known[0],
    monthly = d.monthly.sort((a, b) => a.month - b.month),
    top = known.slice(0, 10),
    headers = [
      "排名 / 变化",
      "品牌",
      "GMV（退后）",
      "同比",
      "市占率",
      "份额变化",
      "件均价",
      "主力价格带",
      "平台构成",
    ];
  const ex = [];
  const rows = known
    .slice(0, 100)
    .map((r, i) => {
      const old = pm.get(r.name),
        sh = ratio(r.g, c.denominator),
        sh0 = ratio(old?.g, c0.denominator),
        change = sh != null && sh0 != null ? sh - sh0 : null,
        mix = r.platforms || [];
      ex.push([
        r.rank || i + 1,
        r.name,
        r.g,
        old ? yoy(r.g, old.g) : null,
        sh,
        change,
        ratio(r.g, r.q),
        null,
        mix.map((x) => PLATFORMS[x.p] + " " + pct(ratio(x.g, r.g))).join("/"),
      ]);
      return `<tr><td>${r.rank || i + 1} <small>${old?.rank ? (old.rank > (r.rank || i + 1) ? "↑" + (old.rank - (r.rank || i + 1)) : old.rank < (r.rank || i + 1) ? "↓" + ((r.rank || i + 1) - old.rank) : "") : ""}</small></td><td><button class="link" data-brand="${esc(r.name)}">${esc(r.name)}</button></td>${cell(r.g, money)}${cell(old ? yoy(r.g, old.g) : null, delta, true)}${cell(sh, pct)}${cell(change, (v) => delta(v, true), true)}<td>¥${num(ratio(r.g, r.q))}</td><td data-main-band="${esc(r.name)}">加载中…</td><td>${mix.map((x) => `<span class="platform-value" style="color:var(--p${x.p})" title="${PLATFORMS[x.p]}">${pct(ratio(x.g, r.g))}</span>`).join(" / ") || "—"}</td></tr>`;
    })
    .join("");
  const series = top.map((r) => ({
    name: r.name,
    values: monthly.map((m) => {
      const found = m.ranks.find((x) => x.name === r.name);
      return found
        ? ratio(
            found.g,
            m.ranks.reduce((s, x) => s + x.g, 0),
          )
        : null;
    }),
  }));
  $("main").innerHTML =
    conclusion(
      lead
        ? `${ym(period().start)}—${ym(S.end)} <b>${esc(lead.name)}</b> 以 ${pct(ratio(lead.g, c.denominator))} 的品牌表内市占率排名第一；CR5 <b>${pct(c.cr5)}</b>，同比变化 ${delta(c.cr5 != null && c0.cr5 != null ? c.cr5 - c0.cr5 : null, true)}。`
        : "当前范围暂无品牌记录",
    ) +
    section(
      "品牌格局",
      `共 ${d.knownCount} 个已识别品牌，展示前100；市占率分母包含未识别品牌`,
      `<p class="note">品牌 / 行业金额 ${pct(c.coverage)}；市占率按品牌表已入库同源范围计算。平台构成：${S.plats.map((p) => `<span style="color:var(--p${p})">■ ${PLATFORMS[p]}</span>`).join("　")}</p>` +
        table("competition-table", headers, rows, ex),
      exportButton("competition-table"),
    ) +
    section(
      "月度市占率",
      "近24个月 · 当前前10品牌；缺失记录断开，不补零",
      chartFrame(
        seriesChart(
          monthly.map((m) => ym(m.month)),
          series,
          { line: S.cmpChart !== "bar", format: pct },
        ),
      ),
      segments("cmpChart", S.cmpChart || "line", [
        ["line", "折线图"],
        ["bar", "堆积柱状图"],
      ]),
    );
  addBars();
  const prices = await analyze("price", ids(), {
    lookupNames: known.slice(0, 100).map((r) => r.name),
  });
  if (t !== token) return;
  document.querySelectorAll("[data-main-band]").forEach((el) => {
    const r = prices.top.find((x) => x.name === el.dataset.mainBand);
    const mapped = prices.mainBands?.[el.dataset.mainBand];
    const best =
      mapped != null
        ? [mapped]
        : r
          ? Object.entries(r.bands).sort((a, b) => b[1] - a[1])[0]
          : null;
    el.textContent = best
      ? +best[0] < 0
        ? "价格缺失"
        : PRICE[+best[0]] + "元"
      : "商品表无对应记录";
    const row = ex.find((x) => x[1] === el.dataset.mainBand);
    if (row) row[7] = el.textContent;
  });
  if (S.mode === "years") {
    const history = await analyze("brand", ids(), {
      yearlyNames: top.map((r) => r.name),
      history: true,
    });
    if (t !== token) return;
    const map = new Map(history.yearly.map((r) => [r.name, r]));
    $("main").insertAdjacentHTML(
      "beforeend",
      section(
        "历年品牌格局",
        "当前前10品牌历年GMV（退后）；当年截至所选月份",
        table(
          "competition-years",
          ["品牌", ...periods().map((p) => p.label)],
          top
            .map(
              (r) =>
                `<tr><td>${esc(r.name)}</td>${periods()
                  .map(
                    (p) =>
                      `<td>${money(map.get(Math.floor(p.end / 100) + "|" + r.name)?.g)}</td>`,
                  )
                  .join("")}</tr>`,
            )
            .join(""),
        ),
      ),
    );
    paginateTables();
  }
}
async function brandReference(t) {
  loadingDetails("品牌深挖");
  const d = await analyze("brand", ids(), {
    brand: S.brand,
    search: S.brandSearch || "",
  });
  if (t !== token) return;
  const known = d.cur.filter((r) => isKnown(r.name)),
    pool = known.filter(
      (r) => !S.brandSearch || r.name.includes(S.brandSearch.toLowerCase()),
    );
  if (!known.length) {
    $("main").innerHTML = section("品牌深挖", "当前范围", "暂无已识别品牌");
    return;
  }
  let brand = known.find((r) => r.name === S.brand) || pool[0] || known[0];
  S.brand = brand.name;
  const old = d.prev.find((r) => r.name === brand.name),
    den = d.cur.reduce((s, r) => s + r.g, 0),
    den0 = d.prev.reduce((s, r) => s + r.g, 0),
    share = ratio(brand.g, den),
    share0 = ratio(old?.g, den0),
    cmp = known.find((r) => r.name === S.compare && r.name !== brand.name),
    comparison = cmp || known.find((r) => r.name !== brand.name);
  const options = pool.slice(0, 150);
  if (!options.some((r) => r.name === brand.name)) options.unshift(brand);
  const focus = `<div class="brand-focus"><label>正在看的品牌 <select id="brand-select">${options.map((r) => `<option ${r.name === brand.name ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></label><span>对比</span><label>对比对象 <select id="brand-compare"><option value="">行业整体</option>${known
    .slice(0, 150)
    .filter((r) => r.name !== brand.name)
    .map(
      (r) =>
        `<option ${r.name === cmp?.name ? "selected" : ""}>${esc(r.name)}</option>`,
    )
    .join(
      "",
    )}</select></label><label>搜索品牌 <input id="brand-search" type="search" value="${esc(S.brandSearch || "")}" placeholder="输入品牌关键词"></label><button data-action="brand-search">搜索</button></div>`;
  const stats =
    kpi(
      "GMV（退后）",
      money(brand.g),
      "同比 " + delta(old ? yoy(brand.g, old.g) : null),
    ) +
    kpi(
      "市占率",
      pct(share),
      "变化 " +
        delta(share != null && share0 != null ? share - share0 : null, true),
    ) +
    kpi(
      "排名",
      "第 " + (brand.rank || known.indexOf(brand) + 1),
      old?.rank ? "上年同期第 " + old.rank : "上年同期排名缺失",
    ) +
    kpi(
      "件均价",
      "¥" + num(ratio(brand.g, brand.q)),
      "同比 " +
        delta(old ? yoy(ratio(brand.g, brand.q), ratio(old.g, old.q)) : null),
    ) +
    kpi(
      "销量",
      money(brand.q) + "件",
      "同比 " + delta(old ? yoy(brand.q, old.q) : null),
    );
  $("main").innerHTML =
    focus +
    conclusion(
      `<b>${esc(brand.name)}</b> ${ym(period().start)}—${ym(S.end)} GMV（退后）${money(brand.g)}，同比 ${delta(old ? yoy(brand.g, old.g) : null)}；品牌表内市占率 ${pct(share)}。当前范围 ${ids().length} 个三级类目。`,
    ) +
    `<div class="kpis">${stats}</div><div id="brand-analysis"><p class="loading" id="brand-load-progress">正在加载品牌趋势与平台分布…</p></div><div id="brand-prices"><p class="loading" id="brand-price-progress">正在加载品牌价格结构…</p></div>`;
  if (ids().length > 12 && !brandCategoryIndex && manifest.brandIndex) {
    brandCategoryIndex = await jsonFile(
      "./data/" + manifest.brandIndex,
      activeController.signal,
    );
    if (t !== token) return;
  }
  const selectedIds = new Set(ids()),
    brandIds = (name) =>
      brandCategoryIndex?.[name]?.filter((id) => selectedIds.has(id)) || ids();
  const detail = await analyze(
    "brand",
    brandIds(S.brand),
    { brand: S.brand, brandOnly: true, history: true },
    true,
  );
  if (t !== token) return;
  let other = null;
  if (comparison) {
    other = await analyze(
      "brand",
      brandIds(comparison.name),
      { brand: comparison.name, brandOnly: true },
      true,
    );
    if (t !== token) return;
  }
  const monthly = d.monthly.sort((a, b) => a.month - b.month),
    labels = monthly.map((m) => ym(m.month)),
    byMonth = new Map(detail.monthly.map((m) => [m.month, m.brand])),
    otherMonth = new Map((other?.monthly || []).map((m) => [m.month, m.brand])),
    mp = new Map((detail.monthlyPlatforms || []).map((r) => [r.name, r]));
  const platSeries = S.plats.map((p) => ({
    name: PLATFORMS[p],
    color: `var(--p${p})`,
    values: monthly.map((m) => mp.get(m.month + "|" + p)?.g ?? null),
  }));
  const shareSeries = [
    {
      name: S.brand,
      values: monthly.map((m) =>
        ratio(
          byMonth.get(m.month)?.g,
          m.ranks.reduce((s, r) => s + r.g, 0),
        ),
      ),
    },
  ];
  if (comparison)
    shareSeries.push({
      name: comparison.name,
      values: monthly.map((m) =>
        ratio(
          otherMonth.get(m.month)?.g,
          m.ranks.reduce((s, r) => s + r.g, 0),
        ),
      ),
    });
  const ph = new Map((detail.platformHistory || []).map((r) => [r.name, r])),
    phSame = new Map((detail.platformSame || []).map((r) => [r.name, r])),
    years = [
      ...new Set(
        (detail.platformHistory || []).map((r) => +r.name.split("|")[0]),
      ),
    ].sort((a, b) => b - a);
  const heads = [
    "年份",
    ...S.plats.flatMap((p) => [
      PLATFORMS[p] + " GMV（退后）",
      "同比（同月份）",
      "占品牌金额",
      "件均价",
    ]),
  ];
  const yearlyRows = years
    .map((y) => {
      const sum = S.plats.reduce(
        (s, p) => s + (ph.get(y + "|" + p)?.g || 0),
        0,
      );
      return `<tr><td>${y}年${y === Math.floor(S.end / 100) ? "（至" + (S.end % 100) + "月）" : ""}</td>${S.plats
        .map((p) => {
          const r = ph.get(y + "|" + p),
            old = (y === Math.floor(S.end / 100) ? phSame : ph).get(
              y - 1 + "|" + p,
            );
          return `<td>${money(r?.g)}</td>${cell(r && old ? yoy(r.g, old.g) : null, delta, true)}${cell(ratio(r?.g, sum), pct)}<td>¥${num(ratio(r?.g, r?.q))}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  const previousPlatforms = new Map(
    (detail.prevByPlatform || []).map((r) => [r.name, r]),
  );
  const currentRows = detail.byPlatform
    .map((r) => {
      const old = previousPlatforms.get(r.name),
        sh = ratio(r.g, brand.g),
        sh0 = ratio(
          old?.g,
          old?.g != null ? d.prev.find((x) => x.name === brand.name)?.g : null,
        );
      return `<tr><td>${PLATFORMS[r.name]}</td>${cell(r.g, money)}${cell(old ? yoy(r.g, old.g) : null, delta, true)}${cell(sh, pct)}${cell(sh != null && sh0 != null ? sh - sh0 : null, (v) => delta(v, true), true)}<td>¥${num(ratio(r.g, r.q))}</td>${cell(old ? yoy(ratio(r.g, r.q), ratio(old.g, old.q)) : null, delta, true)}</tr>`;
    })
    .join("");
  $("brand-analysis").innerHTML =
    section(
      "品牌平台分布",
      S.platView === "period" ? "当前统计时段" : "按年，当年为累计",
      S.platView === "period"
        ? table(
            "brand-platforms",
            [
              "平台",
              "GMV（退后）",
              "同比",
              "占品牌金额",
              "占比变化",
              "件均价",
              "件均价同比",
            ],
            currentRows,
          )
        : table("brand-platforms", heads, yearlyRows),
      segments("platView", S.platView || "year", [
        ["year", "年度"],
        ["period", "当前统计时段"],
      ]),
    ) +
    `<div class="grid2">${section("月度GMV（退后）", "近24个月，按平台", chartFrame(seriesChart(labels, platSeries, { format: money })))}${section("月度市占率", `对比 ${esc(comparison?.name || "暂无其他品牌")} · 品牌表内同源份额`, chartFrame(seriesChart(labels, shareSeries, { line: true, format: pct })))}</div>` +
    section(
      "品牌类目构成",
      "当前所选范围",
      table(
        "brand-categories",
        ["类目路径", "GMV（退后）", "占品牌金额", "详情"],
        detail.byCategory
          .sort((a, b) => b.g - a.g)
          .map(
            (r) =>
              `<tr><td>${esc(catMap.get(r.id)?.path.join(" / "))}</td>${cell(r.g, money)}${cell(ratio(r.g, brand.g), pct)}<td><button data-detail="${esc(JSON.stringify(catMap.get(r.id)?.path))}">类目详情</button></td></tr>`,
          )
          .join(""),
      ),
    );
  addBars();
  const price = await analyze("price", ids(), { brand: S.brand });
  if (t !== token) return;
  const comparePrice = await analyze(
    "price",
    ids(),
    cmp ? { brand: cmp.name } : {},
  );
  if (t !== token) return;
  const mixrow = (label, v) => ({
    label,
    parts: [0, 1, 2, 3, 4, 5, 6, 7, 8, -1].map((b) => ({
      name: b < 0 ? "价格缺失" : PRICE[b] + "元",
      g: v.bins.find((r) => r.name === b)?.g,
    })),
  });
  const pg = price.bins.reduce((s, r) => s + r.g, 0);
  $("brand-prices").innerHTML = section(
    "价格带结构",
    `${esc(S.brand)} 对比 ${esc(cmp?.name || "行业整体")} · 商品表口径`,
    horizontalMix([
      mixrow(S.brand, price),
      mixrow(cmp?.name || "行业整体", comparePrice),
    ]) +
      table(
        "brand-price-table",
        ["价格带", "GMV（退后）", "占品牌商品金额", "销量"],
        price.bins
          .sort((a, b) => a.name - b.name)
          .map(
            (r) =>
              `<tr><td>${r.name < 0 ? "价格缺失" : PRICE[r.name] + "元"}</td>${cell(r.g, money)}${cell(ratio(r.g, pg), pct)}<td>${num(r.q)}</td></tr>`,
          )
          .join(""),
      ) +
      `<p class="note">商品表品牌金额 / 品牌表金额：${pct(ratio(pg, brand.g))}；价格结构使用商品表内部份额。</p>`,
  );
  addBars();
}
