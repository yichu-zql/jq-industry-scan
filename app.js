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
  concentration,
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
          const e = $("load-progress");
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
function totals(list = ids(), start = period().start, end = S.end) {
  return aggregate(index, list, S.plats, start, end);
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
  return pairedAggregate(index, list, plats, start, end);
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
  if (exportRows) exportTables.set(id, [headers, ...exportRows]);
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
    rows += `<tr class="depth${depth}"><td>${depth < 2 ? `<button class="treebtn" data-expand="${esc(key)}" aria-expanded="${opened}">${opened ? "▾" : "▸"} ${esc(label)}</button>` : esc(label)} ${!t.complete ? '<span class="tag">覆盖不全</span>' : ""}<br><small>${compCoverage(c, t, p)}</small></td><td>${money(t.g)}</td>${cell(growth, delta, true)}<td>${pct(share)}</td>${cell(pairedShare != null && share0 != null ? pairedShare - share0 : null, (v) => delta(v, true), true)}<td>${num(t.qtyValid ? t.q / 1e4 : null)}</td><td>${price == null ? "—" : "¥" + num(price)}</td>${cell(aspChange, delta, true)}<td><span class="mix">${mix.map((x) => `<i style="width:${x.v * 100}%;background:var(--p${x.p})"></i>`).join("")}</span>${esc(platText)}</td><td><button data-detail="${esc(key)}">类目详情</button></td></tr>`;
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
    "默认一级，展开二级、三级；平台占比为销量占比，数据条按当前可见行比较",
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
          "平台销量占比",
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
  const start = S.page * 30,
    part = rows.slice(start, start + 30),
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
      ]);
      return `<tr><td><button class="link" data-detail="${esc(JSON.stringify(r.path))}">${esc(r.path[2])}</button><br><small>${esc(r.path.slice(0, 2).join(" / "))}</small></td>${cell(r.annual.g, money)}${cell(annY, delta, true)}<td>${BANDS[r.band]}</td><td>${GROWTH[r.growth.group]}<br><span class="tag">${r.growth.reason}</span></td>${r.growth.ys.map((y) => `<td>${delta(y)}</td>`).join("")}${cell(r.growth.cagr, delta, true)}<td>${c ? pct(c.cr5) : "加载中…"}${c && c.cr5 == null ? "<br>" + reconcileNote(c) : ""}</td>${cell(crdiff, (v) => delta(v, true), true)}<td>${c?.top.length ? c.top.map((b) => esc(b.name) + " " + pct(b.share)).join("<br>") : b ? "—" : "加载中…"}</td><td>${money(r.cur.g)}</td></tr>`;
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
        "TOP3品牌 / 市占率",
        "所选时段GMV（退后）",
      ],
      html,
      ex,
    ) +
    `<div class="pagination"><small>共 ${rows.length} 项 · 当前 ${rows.length ? start + 1 : 0}—${Math.min(start + 30, rows.length)}；CSV导出当前页</small><button data-page="-1" ${S.page === 0 ? "disabled" : ""}>上一页</button><button data-page="1" ${start + 30 >= rows.length ? "disabled" : ""}>下一页</button></div>`
  );
}
async function overview(t) {
  const metrics = await calcMetricsAsync();
  if (t !== token) return;
  const rows = candidateRows(metrics);
  S.page = Math.min(S.page, Math.max(0, Math.ceil(rows.length / 30) - 1));
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
  const part = rows.slice(S.page * 30, S.page * 30 + 30);
  try {
    let data;
    const insightPath = manifest.insights?.[S.end];
    if (insightPath) {
      let summary = insightCache.get(S.end);
      if (!summary) {
        summary = await jsonFile(
          "./data/" + insightPath,
          activeController.signal,
        );
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
function trendMonths() {
  return months(Math.max(manifest.first, shift(S.end, -23)), S.end);
}
function market() {
  const t = totals(),
    p = prevTotals(),
    c = comparable(),
    price = t.qtyValid ? ratio(t.g, t.q) : null;
  const points = trendMonths().map((m) => {
      const a = totals(ids(), m, m);
      return { label: ym(m), v: a.g };
    }),
    growth = trendMonths().map((m) => {
      const a = totals(ids(), m, m),
        b = totals(ids(), shift(m, -12), shift(m, -12)),
        c = comparable(ids(), m, m);
      return {
        label: ym(m),
        v: yoy(c.cur.g, c.prev.g),
      };
    });
  const ps = periods();
  let er = [];
  const rows = ps
    .map((P) => {
      const a = totals(ids(), P.start, P.end),
        b = prevTotals(ids(), P.start, P.end),
        c = comparable(ids(), P.start, P.end),
        price = a.qtyValid ? ratio(a.g, a.q) : null;
      er.push([
        P.label,
        a.g,
        yoy(c.cur.g, c.prev.g),
        a.qtyValid ? a.q : null,
        price,
        ...a.byPlat.map((x) => x.g),
      ]);
      return `<tr><td>${P.label}</td><td>${money(a.g)}${!a.complete ? ' <span class="tag">覆盖不全</span>' : ""}</td>${cell(yoy(c.cur.g, c.prev.g), delta, true)}<td>${num(a.qtyValid ? a.q : null)}</td><td>${price == null ? "—" : "¥" + num(price)}</td>${a.byPlat.map((x) => `<td>${money(x.present ? x.g : null)}</td>`).join("")}</tr>`;
    })
    .join("");
  const scope =
    ids().length === 1
      ? esc(catMap.get(ids()[0]).path.join(" / "))
      : `所选 ${ids().length} 个三级类目合并分析`;
  $("main").innerHTML =
    section(
      "类目大盘",
      scope,
      `${completeNote(t)}<p class="note">${compCoverage(c, t, p)}；可比金额：本期 ${money(c.cur.g)} / 上期 ${money(c.prev.g)}。</p><div class="stats">${unitStat("GMV（退后）", money(t.g), "可比同比 " + pct(yoy(c.cur.g, c.prev.g)))}${unitStat("销量", num(t.qtyValid ? t.q : null), "件")}${unitStat("件均价", price == null ? "—" : "¥" + num(price), "汇总金额 ÷ 汇总销量")}</div><div class="grid2"><div><h3>月度GMV（退后）</h3>${lineChart(points, "月度GMV（退后）")}</div><div><h3>月度同比（可比范围）</h3>${lineChart(growth, "月度GMV（退后）同比", pct)}</div></div>${table("market-table", ["时段", "GMV（退后）", "同比（可比）", "销量", "件均价", ...S.plats.map((p) => PLATFORMS[p] + "GMV（退后）")], rows, er)}`,
      exportButton("market-table"),
    ) +
    section("平台结构", "平台销量占比与金额占比分开展示", platformTable(t, p));
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
async function pricePage(t) {
  loadingDetails("类目价格带");
  const selected = ids();
  const parts = await loadMany("price", selected, t);
  if (t !== token) return;
  const P = period(),
    Q = { start: shift(P.start, -12), end: shift(P.end, -12) },
    cur = priceSum(parts, P),
    prev = priceSum(parts, Q),
    g = [...cur.values()].reduce((s, r) => s + r.g, 0),
    total = totals();
  let ex = [];
  const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, -1]
    .map((b) => {
      const a = cur.get(b),
        z = prev.get(b),
        name = b < 0 ? "价格缺失 / 非正" : PRICE[b] + "元";
      ex.push([
        name,
        a?.g,
        a && z ? yoy(a.g, z.g) : null,
        a ? ratio(a.g, g) : null,
        a?.q,
      ]);
      return `<tr><td><button class="link" data-price="${b}" aria-pressed="${S.price === b}">${name}${S.price === b ? " ✓" : ""}</button></td>${cell(a?.g, money)}${cell(a && z ? yoy(a.g, z.g) : null, delta, true)}<td>${pct(a ? ratio(a.g, g) : null)}</td><td>${num(a?.q)}</td><td>${a ? "¥" + num(ratio(a.g, a.q)) : "—"}</td></tr>`;
    })
    .join("");
  const yearly = periods().map((p) => ({ p, values: priceSum(parts, p) }));
  const yearRows = yearly
    .map(
      ({ p, values }) =>
        `<tr><td>${p.label}</td>${Array.from({ length: 9 }, (_, i) => `<td>${money(values.get(i)?.g)}</td>`).join("")}</tr>`,
    )
    .join("");
  $("main").innerHTML =
    section(
      "类目价格带",
      `${selected.length} 个三级类目 · 商品月度原始件均价（asp）分档 · 不做价格校正`,
      `<p class="note">统一可比较的绝对价格档，左闭右开。价格缺失记录保留在单独一档；点击价格档只筛选本页品牌矩阵，不改变全局行业规模。</p><p class="note ${Math.abs(yoy(g, total.g) ?? Infinity) > 0.01 ? "warning" : ""}">商品明细汇总 / 行业汇总：${pct(ratio(g, total.g))}；本页份额分母为所选商品数据总额。${Math.abs(yoy(g, total.g) ?? Infinity) > 0.01 ? "两源覆盖不一致，本页不能代替行业大盘。" : ""}</p><div class="grid2"><div>${barsChart(
        PRICE.map((name, i) => ({ name: name + "元", v: cur.get(i)?.g })),
        "价格带GMV（退后）",
      )}</div><div>${table("price-table", ["价格带", "GMV（退后）", "同比", "占商品金额", "销量", "件均价"], rows, ex)}</div></div>${S.mode === "years" ? table("price-years", ["年份", ...PRICE.map((n) => n + "元")], yearRows) : ""}`,
      exportButton("price-table"),
    ) +
    section(
      "价格带 × 品牌",
      "各价格带内部的品牌市占率；分母包含未识别品牌",
      '<div id="price-brand"><p class="loading">正在加载品牌价格结构…</p></div>',
      `<button data-action="clear-price" ${S.price == null ? "disabled" : ""}>取消价格带筛选</button>`,
    );
  addBars();
  if (analysisWorker) return priceBrandsFast(t);
  const bp = await loadMany("brandprice", selected, t);
  if (t !== token) return;
  const brandMap = new Map(),
    totalsBand = new Map();
  for (const { rows } of bp)
    for (const r of rows) {
      if (
        r[0] < P.start ||
        r[0] > P.end ||
        !S.plats.includes(r[1]) ||
        (S.price != null && S.price !== r[3])
      )
        continue;
      const band = r[3],
        name = r[2] || "未识别品牌";
      totalsBand.set(band, (totalsBand.get(band) || 0) + (r[4] ?? 0));
      if (!isKnown(name)) continue;
      if (!brandMap.has(name)) brandMap.set(name, { name, g: 0, b: new Map() });
      const v = brandMap.get(name);
      v.g += r[4] ?? 0;
      v.b.set(band, (v.b.get(band) || 0) + (r[4] ?? 0));
    }
  const top = [...brandMap.values()].sort((a, b) => b.g - a.g).slice(0, 20),
    bands = S.price == null ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [S.price];
  const tr = top
    .map(
      (r) =>
        `<tr><td><button class="link" data-brand="${esc(r.name)}">${esc(r.name)}</button></td><td>${money(r.g)}</td>${bands
          .map((b) => {
            const share = ratio(r.b.get(b) || 0, totalsBand.get(b));
            return `<td style="background:color-mix(in srgb,var(--accent) ${Math.min(25, (share || 0) * 60)}%,var(--surface))">${pct(share)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  $("price-brand").innerHTML =
    table(
      "price-brand-table",
      [
        "品牌",
        "GMV（退后）",
        ...bands.map((b) => (b < 0 ? "价格缺失" : PRICE[b] + "元")),
      ],
      tr,
      top.map((r) => [
        r.name,
        r.g,
        ...bands.map((b) => ratio(r.b.get(b) || 0, totalsBand.get(b))),
      ]),
    ) + exportButton("price-brand-table");
}
function joined(parts) {
  return parts.flatMap((p) => p.rows);
}
async function competition(t) {
  if (analysisWorker) return competitionFast(t);
  loadingDetails("竞品格局");
  const parts = await loadMany("brand", ids(), t);
  if (t !== token) return;
  const rows = joined(parts),
    P = period(),
    cur = brandRank(rows, S.plats, P.start, P.end),
    prev = brandRank(rows, S.plats, shift(P.start, -12), shift(P.end, -12)),
    total = totals(),
    prevTotal = prevTotals(),
    c = concentration(cur, total.g, total.complete),
    c0 = concentration(prev, prevTotal.g, prevTotal.complete),
    pm = new Map(prev.map((r) => [r.name, r]));
  let ex = [];
  const tr = cur
    .filter((r) => isKnown(r.name))
    .slice(0, 100)
    .map((r, i) => {
      const old = pm.get(r.name),
        share = c.cr5 != null ? ratio(r.g, total.g) : null,
        share0 = c0.cr5 != null && old ? ratio(old.g, prevTotal.g) : null;
      ex.push([
        i + 1,
        r.name,
        r.g,
        old ? yoy(r.g, old.g) : null,
        share,
        share != null && share0 != null ? share - share0 : null,
        r.q,
        ratio(r.g, r.q),
      ]);
      return `<tr><td>${i + 1}</td><td><button class="link" data-brand="${esc(r.name)}">${esc(r.name)}</button></td>${cell(r.g, money)}${cell(old ? yoy(r.g, old.g) : null, delta, true)}<td>${pct(share)}</td>${cell(share != null && share0 != null ? share - share0 : null, (v) => delta(v, true), true)}<td>${num(r.q)}</td><td>¥${num(ratio(r.g, r.q))}</td></tr>`;
    })
    .join("");
  const crPoints = trendMonths().map((m) => {
    const tt = totals(ids(), m, m);
    return {
      label: ym(m),
      v: concentration(brandRank(rows, S.plats, m, m), tt.g, tt.complete).cr5,
    };
  });
  $("main").innerHTML = section(
    "竞品格局",
    `所选 ${ids().length} 个三级类目合并排名 · 展示前100个已识别品牌`,
    `${completeNote(total)}<div class="stats">${unitStat("行业GMV（退后）", money(total.g))}${unitStat("CR5", pct(c.cr5), c.cr5 != null && c0.cr5 != null ? "同比变化 " + ((c.cr5 - c0.cr5) * 100).toFixed(1) + "pp" : "待对账或缺少同比")}${unitStat("品牌 / 行业金额", pct(c.coverage), "允许对账误差≤1%")}</div>${reconcileNote(c)}<div class="grid2"><div><h3>品牌GMV（退后）前10</h3>${barsChart(
      cur
        .filter((r) => isKnown(r.name))
        .slice(0, 10)
        .map((r) => ({
          name: r.name.length > 12 ? r.name.slice(0, 12) + "…" : r.name,
          v: r.g,
        })),
      "品牌排名",
    )}</div><div><h3>月度CR5</h3>${lineChart(crPoints, "CR5趋势", pct)}</div></div>${table("competition-table", ["排名", "品牌", "GMV（退后）", "同比", "市占率", "份额变化", "销量", "件均价"], tr, ex)}`,
    exportButton("competition-table"),
  );
  addBars();
}
async function brandPage(t) {
  if (analysisWorker) return brandFast(t);
  loadingDetails("品牌深挖");
  const parts = await loadMany("brand", ids(), t);
  if (t !== token) return;
  const rows = joined(parts),
    P = period(),
    cur = brandRank(rows, S.plats, P.start, P.end).filter((r) =>
      isKnown(r.name),
    ),
    prev = brandRank(rows, S.plats, shift(P.start, -12), shift(P.end, -12)),
    total = totals(),
    prevTotal = prevTotals(),
    allRank = brandRank(rows, S.plats, P.start, P.end),
    checked = concentration(allRank, total.g, total.complete);
  if (!cur.length) {
    $("main").innerHTML = section(
      "品牌深挖",
      "当前范围",
      '<p class="empty">暂无已识别品牌数据</p>',
    );
    return;
  }
  if (!cur.some((r) => r.name === S.brand)) S.brand = cur[0].name;
  const brand = cur.find((r) => r.name === S.brand),
    prior = prev.find((r) => r.name === S.brand),
    rank = cur.findIndex((r) => r.name === S.brand) + 1;
  const options = cur
    .filter(
      (r) =>
        r.name === S.brand ||
        !S.brandSearch ||
        r.name.toLowerCase().includes(S.brandSearch.toLowerCase()),
    )
    .slice(0, 150)
    .map(
      (r) =>
        `<option ${r.name === S.brand ? "selected" : ""} value="${esc(r.name)}">${esc(r.name)}</option>`,
    )
    .join("");
  const pts = trendMonths().map((m) => ({
    label: ym(m),
    v:
      brandRank(rows, S.plats, m, m).find((r) => r.name === S.brand)?.g ?? null,
  }));
  let ex = [];
  const yr = periods()
    .map((p) => {
      const a = brandRank(rows, S.plats, p.start, p.end).find(
          (r) => r.name === S.brand,
        ),
        b = brandRank(
          rows,
          S.plats,
          shift(p.start, -12),
          shift(p.end, -12),
        ).find((r) => r.name === S.brand);
      ex.push([
        p.label,
        a?.g,
        a && b ? yoy(a.g, b.g) : null,
        a?.q,
        a ? ratio(a.g, a.q) : null,
      ]);
      return `<tr><td>${p.label}</td><td>${money(a?.g)}</td>${cell(a && b ? yoy(a.g, b.g) : null, delta, true)}<td>${num(a?.q)}</td><td>${a ? "¥" + num(ratio(a.g, a.q)) : "—"}</td></tr>`;
    })
    .join("");
  let categoryParts = parts;
  if (parts.some((p) => p.id.startsWith("scope_"))) {
    if (!brandCategoryIndex && manifest.brandIndex)
      brandCategoryIndex = await jsonFile(
        "./data/" + manifest.brandIndex,
        activeController.signal,
      );
    const relevant = (brandCategoryIndex?.[S.brand] || ids()).filter((id) =>
      ids().includes(id),
    );
    categoryParts = await loadMany("brand", relevant, t, true);
    if (t !== token) return;
  }
  const catRows = categoryParts
    .map((part) => ({
      id: part.id,
      r: brandRank(part.rows, S.plats, P.start, P.end).find(
        (r) => r.name === S.brand,
      ),
      all: totals([part.id]),
    }))
    .filter((x) => x.r)
    .sort((a, b) => b.r.g - a.r.g);
  const catHtml = catRows
    .map((x) => {
      const ranks = brandRank(
          categoryParts.find((p) => p.id === x.id).rows,
          S.plats,
          P.start,
          P.end,
        ),
        valid = concentration(ranks, x.all.g, x.all.complete).cr5 != null;
      return `<tr><td>${esc(catMap.get(x.id)?.path.join(" / "))}</td><td>${money(x.r.g)}</td><td>${pct(ratio(x.r.g, brand.g))}</td><td>${valid ? pct(ratio(x.r.g, x.all.g)) : "待对账"}</td></tr>`;
    })
    .join("");
  const platformRows = S.plats.map((p) => {
    const r = brandRank(rows, [p], P.start, P.end).find(
      (r) => r.name === S.brand,
    );
    return { name: PLATFORMS[p], v: r?.g };
  });
  $("main").innerHTML =
    section(
      "品牌深挖",
      `品牌份额只针对当前所选 ${ids().length} 个三级类目，不能解释为品牌全市场份额`,
      `<div class="toolbar"><label>搜索品牌 <input type="search" id="brand-search" value="${esc(S.brandSearch || "")}" placeholder="输入品牌关键词"></label><button data-action="brand-search">搜索</button><label>正在看的品牌 <select id="brand-select">${options}</select></label><small>选择列表最多显示150项，可搜索完整品牌池</small></div><div class="stats">${unitStat("GMV（退后）", money(brand.g), "同比 " + pct(prior ? yoy(brand.g, prior.g) : null))}${unitStat("市占率", checked.cr5 != null ? pct(ratio(brand.g, total.g)) : "待对账")}${unitStat("品牌排名", rank + " / " + cur.length)}${unitStat("件均价", "¥" + num(ratio(brand.g, brand.q)))}</div><div class="grid2"><div><h3>月度GMV（退后）</h3>${lineChart(pts, "品牌月度销售额")}</div><div><h3>当前时段平台结构</h3>${barsChart(platformRows, "品牌平台金额")}</div></div>${table("brand-years", ["时段", "GMV（退后）", "同比", "销量", "件均价"], yr, ex)}`,
      exportButton("brand-years"),
    ) +
    section(
      "品牌类目构成",
      "占品牌：所选类目中的品牌金额构成；类目市占率：品牌金额÷该类目总额",
      table(
        "brand-categories",
        ["类目路径", "GMV（退后）", "占所选品牌金额", "类目内市占率"],
        catHtml,
      ),
    ) +
    section(
      "品牌价格带",
      "同一筛选范围，来自商品月度数据；与品牌汇总表分别核对",
      '<div id="brand-prices"><p class="loading">正在加载价格结构…</p></div>',
    );
  addBars();
  const bp = await loadMany("brandprice", ids(), t);
  if (t !== token) return;
  const values = priceSum(bp, P, S.brand),
    g = [...values.values()].reduce((s, r) => s + r.g, 0);
  $("brand-prices").innerHTML =
    `<p class="note">商品表品牌金额 / 品牌表金额：${pct(ratio(g, brand.g))}。价格带占比以商品表中该品牌的金额为分母。</p>` +
    table(
      "brand-price-table",
      ["价格带", "GMV（退后）", "占品牌商品金额", "销量"],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, -1]
        .map((b) => {
          const a = values.get(b);
          return `<tr><td>${b < 0 ? "价格缺失" : PRICE[b] + "元"}</td><td>${money(a?.g)}</td><td>${pct(a ? ratio(a.g, g) : null)}</td><td>${num(a?.q)}</td></tr>`;
        })
        .join(""),
    );
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
    )}</details><details class="method" open><summary>指标和增长规则</summary><ul><li>GMV（退后）使用源表 gmv，单位为人民币元；页面按金额自动显示万/亿，CSV统一导出元。延续原看板的久谦退后口径；表结构没有独立退款字段，不通过退前减退款重新推算。</li><li>件均价＝汇总GMV（退后）÷汇总销量，不能平均商品单价。份额变化及 CR5 同比变化使用百分点 pp。</li><li>增长档：三个完整年度同比均负＝持续下滑；均正且三年 CAGR＜20%＝持续中低速增长；均正且 CAGR≥20%＝持续高速增长；其余＝持平或波动增长/回落。</li><li>三年 CAGR＝最后一年金额÷三年前金额的立方根−1。判断三个年度同比需要四个完整年度；任何必需月份、平台、基期缺失则暂无法判断。</li><li>入选增长品类：年GMV（退后）≥1亿元，并满足连续三年同比均＞0，或近三个完整年度至少一年同比严格＞50%。</li><li>年规模采用截止月向前12个月；同比再向前移12个月。单月、年累计和自定义时段影响普通分析，矩阵始终保持完整年规模；年份判断以截止月前最近完整年度为准。</li><li>行业占比＝当前类目已入库金额÷全局所选已入库金额；行业结构、类目大盘和历年行业同比采用两期都有记录的相同类目-月份-平台集合，份额变化也使用该共同集合，覆盖率单独列示；展开子类目不改变分母。多选按三级类目ID去重。父子级不重复累计。</li><li>CR5＝本期前5个已识别品牌金额÷行业金额。上年独立选取前5品牌。其他 Other、无品牌和未识别品牌计入分母、不参与排名。品牌与行业金额偏差超过1%或范围不完整时，不展示CR5和品牌市占率。</li><li>价格带按原始 asp 划分，左闭右开；缺失及非正价格独立保留。价格带和品牌价格结构的份额分母来自商品表，不能直接套用行业表。</li><li>缺失与零值区分：无源记录不当作零。累计值可展示已入库金额并提示缺月；不完整范围不计算整体现有范围同比或年分档；行业可比同比只使用两期共同记录，并明确显示可比覆盖率。品牌未出现不推断为新品牌或真实零销售。</li></ul></details><details class="method" open><summary>本次校验结果</summary><p>${esc(a.summary || "详见数据检查文件")}</p><p>源表含负金额或负销量的聚合记录：${esc(JSON.stringify(a.negativeRows || {}))}。保留原始汇总，非正销量不计算件均价；这些记录的修订原因源表未说明。</p><p>行业原始键冲突：${a.industryConflicts ?? "—"}；映射歧义路径：${a.mappingAmbiguities ?? "—"}。事实表已带久谦路径，不通过映射表多对多关联放大金额。</p><p>品牌 / 行业对账通过：${a.brandMatched ?? "—"} / ${a.brandCompared ?? "—"} 个可比三级类目（最近12个月，全平台）。未通过类目保留金额展示，CR5与份额留空并提示。</p><p>商品 / 行业对账通过：${a.priceMatched ?? "—"} / ${a.priceCompared ?? "—"}。店铺表用于汇总核验，不以店铺名推断品牌，不展示商品系列。</p></details><details class="method" open><summary>更新与发布</summary><p id="schedule-status">${esc(manifest.updateStatus || "手动更新脚本已提供，定时任务尚未启用。")}</p><ol><li>只读获取五张久谦源表；核对入库时间和月份覆盖。</li><li>形成隔离候选数据，检查精确键、类目路径、月份连续性、负值和跨表口径。</li><li>无实质变化不产生数据版本；校验失败保留线上上一成功版本。</li><li>通过检查后提交源码和聚合数据，推送 GitHub Pages，再检查正式页面与版本。</li></ol><p>所有源表缺少可用索引，当前全量聚合成本较高。首次版本采用全量快照；不把未实现的最近三个月增量更新写成已启用。</p></details><p>数据可公开访问；网站不保存数据库凭据，不由浏览器直接连接数据库。筛选状态仅存当前浏览器。</p></div>`,
  );
}
async function render() {
  analysisWorker?.postMessage({ type: "cancel" });
  for (const job of analysisJobs.values())
    job.reject(new DOMException("请求已取消", "AbortError"));
  analysisJobs.clear();
  dataWorker?.postMessage({ type: "cancel" });
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
    else if (S.view === "market") market();
    else if (S.view === "price") await pricePage(t);
    else if (S.view === "competition") await competition(t);
    else if (S.view === "brand") await brandPage(t);
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
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.view) {
    S.view = b.dataset.view;
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
    new URL("./lib/metrics-worker.js", import.meta.url),
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
  metricsWorker.postMessage({ type: "init", rows: industry.rows });
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
  dataWorker = new Worker(new URL("./lib/data-worker.js", import.meta.url), {
    type: "module",
  });
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
    manifest = await jsonFile("./data/manifest.json?version=" + Date.now());
    industry = await jsonFile("./data/" + manifest.industry);
    categories = industry.categories;
    catMap = new Map(categories.map((c) => [c.id, c]));
    index = indexIndustry(industry.rows);
    setupWorker();
    S.end = Math.min(
      manifest.last,
      Math.max(manifest.first, S.end || manifest.last),
    );
    S.start = Math.min(S.end, Math.max(manifest.first, S.start));
    S.cats = S.cats === null ? null : S.cats.filter((id) => catMap.has(id));
    const v = location.hash.slice(1);
    if (views.some((x) => x[0] === v)) S.view = v;
    $("footer").textContent =
      `久谦数据 · ${manifest.version} · ${categories.length}个三级类目 · 最近成功数据生成 ${manifest.built}（北京时间）`;
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
    new URL("./lib/analysis-worker.js", import.meta.url),
    { type: "module" },
  );
  analysisWorker.onmessage = ({ data: m }) => {
    const job = analysisJobs.get(m.id);
    if (!job) return;
    if (m.progress != null) {
      const e = $("load-progress");
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
async function priceBrandsFast(t) {
  const d = await analyze("price", ids(), { band: S.price });
  if (t !== token) return;
  const bins = new Map(d.bins.map((r) => [r.name, r.g])),
    bands = S.price == null ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [S.price];
  const rows = d.top
    .map(
      (r) =>
        `<tr><td><button class="link" data-brand="${esc(r.name)}">${esc(r.name)}</button></td><td>${money(r.g)}</td>${bands
          .map((b) => {
            const share = ratio(r.bands[b] || 0, bins.get(b));
            return `<td style="background:color-mix(in srgb,var(--accent) ${Math.min(25, (share || 0) * 60)}%,var(--surface))">${pct(share)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  $("price-brand").innerHTML =
    table(
      "price-brand-table",
      [
        "品牌",
        "GMV（退后）",
        ...bands.map((b) => (b < 0 ? "价格缺失" : PRICE[b] + "元")),
      ],
      rows,
      d.top.map((r) => [
        r.name,
        r.g,
        ...bands.map((b) => ratio(r.bands[b] || 0, bins.get(b))),
      ]),
    ) + exportButton("price-brand-table");
}
async function competitionFast(t) {
  loadingDetails("竞品格局");
  const d = await analyze("brand", ids());
  if (t !== token) return;
  const total = totals(),
    prior = prevTotals(),
    c = concentration(d.cur, total.g, total.complete),
    c0 = concentration(d.prev, prior.g, prior.complete),
    pm = new Map(d.prev.map((r) => [r.name, r])),
    known = d.cur.filter((r) => isKnown(r.name));
  const exports = [];
  const rows = known
    .slice(0, 100)
    .map((r, i) => {
      const old = pm.get(r.name),
        sh = c.cr5 != null ? ratio(r.g, total.g) : null,
        sh0 = c0.cr5 != null && old ? ratio(old.g, prior.g) : null;
      exports.push([
        i + 1,
        r.name,
        r.g,
        old ? yoy(r.g, old.g) : null,
        sh,
        sh != null && sh0 != null ? sh - sh0 : null,
        r.q,
        ratio(r.g, r.q),
      ]);
      return `<tr><td>${i + 1}</td><td><button class="link" data-brand="${esc(r.name)}">${esc(r.name)}</button></td>${cell(r.g, money)}${cell(old ? yoy(r.g, old.g) : null, delta, true)}<td>${pct(sh)}</td>${cell(sh != null && sh0 != null ? sh - sh0 : null, (v) => delta(v, true), true)}<td>${num(r.q)}</td><td>¥${num(ratio(r.g, r.q))}</td></tr>`;
    })
    .join("");
  const points = d.monthly
    .sort((a, b) => a.month - b.month)
    .map((m) => {
      const a = totals(ids(), m.month, m.month);
      return {
        label: ym(m.month),
        v: concentration(m.ranks, a.g, a.complete).cr5,
      };
    });
  $("main").innerHTML = section(
    "竞品格局",
    `所选 ${ids().length} 个三级类目合并排名 · 共 ${d.knownCount} 个已识别品牌，展示前100`,
    `${completeNote(total)}<div class="stats">${unitStat("行业GMV（退后）", money(total.g))}${unitStat("CR5", pct(c.cr5), c.cr5 != null && c0.cr5 != null ? "同比变化 " + ((c.cr5 - c0.cr5) * 100).toFixed(1) + "pp" : "待对账或缺少同比")}${unitStat("品牌 / 行业金额", pct(c.coverage), "允许对账误差≤1%")}</div>${reconcileNote(c)}<div class="grid2"><div><h3>品牌GMV（退后）前10</h3>${barsChart(
      known.slice(0, 10).map((r) => ({
        name: r.name.length > 12 ? r.name.slice(0, 12) + "…" : r.name,
        v: r.g,
      })),
      "品牌排名",
    )}</div><div><h3>月度CR5</h3>${lineChart(points, "月度CR5", pct)}</div></div>${table("competition-table", ["排名", "品牌", "GMV（退后）", "同比", "市占率", "份额变化", "销量", "件均价"], rows, exports)}`,
    exportButton("competition-table"),
  );
  addBars();
  if (S.mode === "years") {
    const history = await analyze("brand", ids(), {
      yearlyNames: known.slice(0, 10).map((r) => r.name),
      history: true,
    });
    if (t !== token) return;
    const map = new Map(history.yearly.map((r) => [r.name, r.g])),
      ps = periods();
    const tr = known
      .slice(0, 10)
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td>${ps.map((p) => `<td>${money(map.get(Math.floor(p.end / 100) + "|" + r.name))}</td>`).join("")}</tr>`,
      )
      .join("");
    $("main").insertAdjacentHTML(
      "beforeend",
      section(
        "头部品牌历年规模",
        "本期前10品牌 · 各年度GMV（退后）；末年显示截至所选月份",
        table("competition-years", ["品牌", ...ps.map((p) => p.label)], tr),
      ),
    );
  }
}
async function brandFast(t) {
  loadingDetails("品牌深挖");
  const d = await analyze("brand", ids(), {
    brand: S.brand,
    search: S.brandSearch || "",
  });
  if (t !== token) return;
  const known = d.cur.filter((r) => isKnown(r.name));
  if (!known.length) {
    $("main").innerHTML = section(
      "品牌深挖",
      "当前所选范围",
      '<p class="empty">暂无已识别品牌记录</p>',
    );
    return;
  }
  if (!known.some((r) => r.name === S.brand)) S.brand = known[0].name;
  const brand = known.find((r) => r.name === S.brand),
    prev = d.prev.find((r) => r.name === S.brand),
    total = totals(),
    con = concentration(d.cur, total.g, total.complete);
  const hits = known
    .filter(
      (r) =>
        r.name !== S.brand &&
        (!S.brandSearch ||
          r.name.toLowerCase().includes(S.brandSearch.toLowerCase())),
    )
    .slice(0, 149);
  const opts = [brand, ...hits]
    .map(
      (r) =>
        `<option value="${esc(r.name)}" ${r.name === S.brand ? "selected" : ""}>${esc(r.name)}</option>`,
    )
    .join("");
  $("main").innerHTML =
    section(
      "品牌深挖",
      `品牌份额针对所选 ${ids().length} 个三级类目，不代表品牌全市场份额`,
      `<div class="toolbar"><label>搜索品牌 <input type="search" id="brand-search" value="${esc(S.brandSearch || "")}" placeholder="输入品牌关键词"></label><button data-action="brand-search">搜索</button><label>正在看的品牌 <select id="brand-select">${opts}</select></label><small>完整品牌池搜索，最多显示150个选项</small></div><div class="stats">${unitStat("GMV（退后）", money(brand.g), "同比 " + pct(prev ? yoy(brand.g, prev.g) : null))}${unitStat("市占率", con.cr5 != null ? pct(ratio(brand.g, total.g)) : "待对账")}${unitStat("品牌排名", brand.rank + " / " + d.knownCount)}${unitStat("件均价", "¥" + num(ratio(brand.g, brand.q)))}</div><div id="brand-analysis"><p class="loading">正在加载该品牌的类目、平台与趋势…</p></div>`,
    ) +
    section(
      "品牌价格带",
      "按当前所选时段、平台、类目计算；商品来源与品牌来源分别对账",
      '<div id="brand-prices"><p class="loading">正在加载价格结构…</p></div>',
    );
  if (!brandCategoryIndex && manifest.brandIndex)
    brandCategoryIndex = await jsonFile(
      "./data/" + manifest.brandIndex,
      activeController.signal,
    );
  if (t !== token) return;
  const selected = new Set(ids()),
    relevant = (brandCategoryIndex?.[S.brand] || ids()).filter((id) =>
      selected.has(id),
    );
  const detail = await analyze(
    "brand",
    relevant,
    { brand: S.brand, brandOnly: true },
    true,
  );
  if (t !== token) return;
  const monthMap = new Map(
    detail.monthly.map((x) => [x.month, x.brand?.g ?? null]),
  );
  const points = trendMonths().map((m) => ({
    label: ym(m),
    v: monthMap.get(m) ?? null,
  }));
  const catRows = detail.byCategory
    .sort((a, b) => b.g - a.g)
    .map((r) => {
      const a = totals([r.id]);
      return `<tr><td><button class="link" data-detail="${esc(JSON.stringify(catMap.get(r.id).path))}">${esc(catMap.get(r.id).path.join(" / "))}</button></td>${cell(r.g, money)}<td>${pct(ratio(r.g, brand.g))}</td><td>${a.complete && Math.abs(yoy(r.sourceTotal, a.g) ?? Infinity) <= 0.01 ? pct(ratio(r.g, a.g)) : "—"}</td></tr>`;
    })
    .join("");
  const yrMap = new Map(detail.yearly.map((r) => [r.name, r])),
    sameMap = new Map(detail.yearSame.map((r) => [r.name, r]));
  const yrRows = periods()
    .map((P) => {
      const y = Math.floor(P.end / 100),
        a = yrMap.get(y + "|" + S.brand),
        b = (
          y === Math.floor(S.end / 100) && S.end % 100 < 12 ? sameMap : yrMap
        ).get(y - 1 + "|" + S.brand);
      return `<tr><td>${P.label}</td><td>${money(a?.g)}</td><td>${delta(a && b ? yoy(a.g, b.g) : null)}</td><td>${num(a?.q)}</td><td>${a ? "¥" + num(ratio(a.g, a.q)) : "—"}</td></tr>`;
    })
    .join("");
  $("brand-analysis").innerHTML =
    `${S.mode === "years" ? table("brand-year-history", ["年度", "GMV（退后）", "同比（同月份）", "销量", "件均价"], yrRows) : ""}<div class="grid2"><div><h3>月度GMV（退后）</h3>${lineChart(points, "品牌月度GMV（退后）")}</div><div><h3>平台结构</h3>${barsChart(
      detail.byPlatform.map((r) => ({ name: PLATFORMS[r.name], v: r.g })),
      "品牌平台GMV（退后）",
    )}</div></div><div class="section-head"><h3>品牌类目构成</h3>${exportButton("brand-categories")}</div>${table(
      "brand-categories",
      ["类目路径", "GMV（退后）", "占品牌金额", "类目内市占率"],
      catRows,
      detail.byCategory.map((r) => [
        catMap.get(r.id).path.join("/"),
        r.g,
        ratio(r.g, brand.g),
        totals([r.id]).complete &&
        Math.abs(yoy(r.sourceTotal, totals([r.id]).g) ?? Infinity) <= 0.01
          ? ratio(r.g, totals([r.id]).g)
          : null,
      ]),
    )}`;
  addBars();
  const price = await analyze("price", relevant, { brand: S.brand });
  if (t !== token) return;
  const pg = price.bins.reduce((s, r) => s + r.g, 0),
    bins = new Map(price.bins.map((r) => [r.name, r]));
  $("brand-prices").innerHTML =
    `<p class="note">商品表品牌金额 / 品牌表金额：${pct(ratio(pg, brand.g))}；价格带占比以商品表中该品牌金额为分母。</p>${table(
      "brand-price-table",
      ["价格带", "GMV（退后）", "占品牌商品金额", "销量"],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, -1]
        .map((b) => {
          const r = bins.get(b);
          return `<tr><td>${b < 0 ? "价格缺失" : PRICE[b] + "元"}</td><td>${money(r?.g)}</td><td>${pct(r ? ratio(r.g, pg) : null)}</td><td>${num(r?.q)}</td></tr>`;
        })
        .join(""),
    )}`;
}
boot();
