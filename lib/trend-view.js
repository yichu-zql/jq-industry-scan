import {
  dataBar,
  platformMix,
  platformLegend,
  metricTable,
  PLATFORM_COLORS,
} from "./trend-display.js?v=2.7.0";
import { PLATFORMS, csv, ratio } from "./metrics.js";
import { number, percent } from "./trend-model.js?v=2.7.0";
import { esc, chartSVG, rawRows } from "./trend-chart.js?v=2.7.0";
import { editableWorkbook } from "./trend-export.js?v=2.7.0";
import { mountSelection } from "./trend-selection.js?v=2.7.0";
let initializedIndustry, initializedManifest;
let worker,
  job = 0,
  active = null,
  saved = null;
const signed = (v) =>
  Number.isFinite(v) ? (v > 0 ? "+" : "") + percent(v) : "—";
const pp = (v) => (Number.isFinite(v) ? (v * 100).toFixed(2) + "pp" : "—");
function download(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const buttons = (name, chart = false) =>
  `<div class="trend-downloads">${chart ? `<button data-trend-download="${name}" data-format="xlsx">可编辑图表 Excel</button><button data-trend-download="${name}" data-format="svg">矢量图 SVG</button>` : `<button data-trend-download="${name}" data-format="xlsx">可编辑表格 Excel</button>`}<button data-trend-download="${name}" data-format="csv">${chart ? "图表" : "表格"}数据 CSV</button></div>`;
const numericTable = metricTable;
export function mountTrends(ctx) {
  const host = ctx.element,
    first = Math.floor(ctx.manifest.first / 100),
    last = Math.floor(ctx.manifest.last / 100),
    cats = ctx.industry.categories.filter(c => !["商用设备","家居建材","家装建材","影音乐器","生活电器","大家电"].includes(c.path[0]));
  const localSQL = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);
  const state = saved || {
    ids: new Set(ctx.ids),
    name: "",
    theme: "report",
    startYear: Math.max(first, last - 2),
    endYear: last,
    cutoff: ctx.manifest.last % 100,
    plats: [...ctx.plats],
  };
  state.ids = new Set([...state.ids].filter(id => cats.some(c => c.id === id)));
  state.historyYears ??= Math.max(3, state.endYear - state.startYear + 1);
  saved = state;
  const years = Array.from(
    { length: last - first + 1 },
    (_, i) => `<option>${first + i}</option>`,
  ).join("");
  host.innerHTML = `<section class="panel trend-controls"><h2>自定义行业速览</h2>${localSQL ? '<p class="note">本机 Python · ulike_tmp 分析库 · 首次查询准备数据，后续直接查表</p>' : ""}<div class="toolbar"><label>展示方式 <select id="trend-theme"><option value="report">报告模板</option><option value="dashboard">平台看板</option></select></label></div><div id="trend-selection"></div><div class="toolbar"><label>趋势起始年 <select id="trend-start">${years}</select></label><label>分析年份 <select id="trend-end">${years}</select></label><label>末年截至 <select id="trend-cutoff">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}月</option>`).join("")}</select></label>${PLATFORMS.map((p, i) => `<label><input type="checkbox" data-trend-plat value="${i}" ${state.plats.includes(i) ? "checked" : ""}>${p}</label>`).join("")}</div><div class="toolbar"><button id="trend-generate" class="primary">生成速览</button><button id="trend-print" disabled>打印 / 保存PDF</button><span id="trend-status" role="status">选择范围后生成</span></div><p class="note">GMV退后 · 同比共同记录 · 各模块按对应源表<span id="trend-range"></span></p></section><div class="trend-report" id="trend-results"></div>`;
  const $ = (id) => host.querySelector("#" + id);
  let filter,
    meta = [],
    models = {},
    rowsByName = {},
    percentByName = {},
    dirty = true,
    currentId = 0,
    market,
    brands,
    prices,
    priceMode = "gmv",
    productInfo = null;
  function invalidate() {
    dirty = true;
    ++job;
    worker?.postMessage({ type: "cancel" });
    $("trend-print").disabled = true;
    $("trend-generate").disabled = false;
    $("trend-status").dataset.ready = "false";
    $("trend-status").textContent = "条件已调整，请生成速览";
    $("trend-results").classList.add("outdated");
    if (state.ruleDraft || state.confirmedRule?.text)
      $("trend-results").replaceChildren();
    host
      .querySelectorAll("[data-trend-download]")
      .forEach((b) => (b.disabled = true));
  }
  host.dataset.trendTheme = state.theme || "report";
  $("trend-theme").value = state.theme || "report";
  $("trend-theme").onchange = () => {
    state.theme = $("trend-theme").value;
    host.dataset.trendTheme = state.theme;
    if (market && !dirty) {
      const a = market,
        b = brands,
        p = prices,
        info = productInfo;
      marketReady(a);
      if (b) brandsReady(b);
      if (p) pricesReady(p);
      if (info) productsReady(info);
    }
  };
  mountSelection($("trend-selection"), cats, state, invalidate, download, new Set(ctx.industry.categories.filter(c => !cats.includes(c)).map(c => c.id)));
  for (const [id, key] of [
    ["trend-start", "startYear"],
    ["trend-end", "endYear"],
    ["trend-cutoff", "cutoff"],
  ]) {
    $(id).value = state[key];
    $(id).onchange = () => {
      state[key] = +$(id).value;
      if (key === "endYear" && state.endYear === last) {
        state.cutoff = Math.min(state.cutoff, ctx.manifest.last % 100);
        $("trend-cutoff").value = state.cutoff;
      }
      if (key === "endYear" || key === "startYear") {
        if (key === "startYear")
          state.historyYears = Math.max(3, state.endYear - state.startYear + 1);
        state.startYear = Math.max(
          first,
          state.endYear - state.historyYears + 1,
        );
        $("trend-start").value = state.startYear;
      }
      invalidate();
    };
  }
  host.querySelectorAll("[data-trend-plat]").forEach(
    (e) =>
      (e.onchange = () => {
        state.plats = [
          ...host.querySelectorAll("[data-trend-plat]:checked"),
        ].map((x) => +x.value);
        invalidate();
      }),
  );
  function kpis() {
    if (!market) return;
    const k = market.kpi,
      b = brands,
      delta =
        b && b.cr5 !== null && b.priorCr5 !== null ? b.cr5 - b.priorCr5 : null;
    const values = [
      ["GMV（退后）", number(k.g), `同比 ${signed(k.y)}`],
      ["销量", number(k.q), `同比 ${signed(k.qy)}`],
      ["件均价", "¥" + number(k.asp), `同比 ${signed(k.ay)}`],
      ["CR5", b ? percent(b.cr5) : "加载中", b ? `变化 ${pp(delta)}` : ""],
      [
        "第一品牌",
        b ? b.top[0]?.name || "—" : "加载中",
        b ? `市占率 ${percent(b.top[0]?.share)}` : "",
      ],
    ];
    $("trend-kpis").innerHTML = values
      .map(
        (v) =>
          `<article><small>${v[0]}</small><strong>${esc(v[1])}</strong><span>${esc(v[2])}</span></article>`,
      )
      .join("");
    rowsByName.kpis = [
      ["指标", "当前值", "同比 / 份额变化（小数）"],
      ["GMV（元）", k.g, k.y],
      ["销量（件）", k.q, k.qy],
      ["件均价（元）", k.asp, k.ay],
      ["CR5（小数）", b?.cr5 ?? null, delta],
      ["第一品牌", b?.top[0]?.name || "", null],
      ["第一品牌份额（小数）", b?.top[0]?.share ?? null, null],
    ];
    percentByName.kpis = [2];
  }
  function marketReady(m) {
    market = m;
    brands = null;
    prices = null;
    productInfo = null;
    models = {
      channels: {
        ...m.channels,
        series: m.channels.series.map((v) => ({
          ...v,
          color:
            state.theme === "dashboard"
              ? PLATFORM_COLORS[PLATFORMS.indexOf(v.name)]
              : v.color,
        })),
      },
    };
    rowsByName = {};
    percentByName = {};
    const v = models.channels;
    const platformRows = [
      [
        "平台",
        ...v.labels.map((l) => l + " GMV（元）"),
        ...v.labels.map((l) => l + " 同比（小数）"),
        ...v.labels.map((l) => l + " 份额（小数）"),
      ],
      ...v.series.map((s) => [
        s.name,
        ...s.values,
        ...s.growth,
        ...s.values.map((g, i) => ratio(g, v.totals[i])),
      ]),
      [
        "合计",
        ...v.totals,
        ...(v.periodGrowth || v.growth),
        ...v.totals.map((g) => (g > 0 ? 1 : null)),
      ],
    ];
    rowsByName.platforms = platformRows;
    percentByName.platforms = Array.from(
      { length: v.labels.length * 2 },
      (_, i) => 1 + v.labels.length + i,
    );
    const lead = v.series
      .slice()
      .sort((a, b) => (b.values.at(-1) || 0) - (a.values.at(-1) || 0))[0];
    $("trend-results").innerHTML =
      `<section class="panel"><h2>${esc(filter.name)}</h2><p class="note">${filter.ids.length}个三级类目 · ${esc(meta[1][1])} · ${filter.endYear}年1—${filter.cutoff}月</p><div id="trend-kpis" class="trend-kpis"></div>${buttons("kpis")}</section><section class="panel"><h2>① 市场规模</h2><p class="trend-summary">当前规模 ${number(m.kpi.g)}，可比同比 ${signed(m.kpi.y)}；${m.kpi.g > 0 ? `${esc(lead?.name || "—")}为主要平台，占比 ${percent(ratio(lead?.values.at(-1), m.kpi.g))}。` : "当期未命中商品，请核对包含词、排除词和类目范围。"}</p><div class="market-layout"><article class="trend-chart">${buttons("channels", true)}<div class="trend-svg">${chartSVG(v)}</div></article><section class="platform-table"><h3>平台规模与结构</h3>${buttons("platforms")}${numericTable(platformRows, percentByName.platforms)}</section></div></section><section class="panel" id="trend-prices"><h2>② 细分价格带</h2><p class="note">正在加载价格带…</p></section><section class="panel" id="trend-competition"><h2>③ 竞争格局</h2><p class="note">正在加载品牌…</p></section>`;
    $("trend-results").classList.remove("outdated");
    $("trend-range").textContent =
      ` · ${filter.startYear}—${filter.endYear}年（末年至${filter.cutoff}月）`;
    $("trend-status").textContent = "规模已生成，正在加载品牌和价格带…";
    dirty = false;
    if (m.productInfo) productsReady(m.productInfo);
    else if (ctx.manifest.products)
      $("trend-results").insertAdjacentHTML(
        "beforeend",
        '<section class="panel" id="trend-products"><h2>④ TOP10商品</h2><p class="note">正在加载商品…</p></section>',
      );
    kpis();
  }
  function productsReady(info) {
    productInfo = info;
    if (info.queryVersion) {
      meta = meta.filter(r => !["商品数据版本", "商品源更新时间", "无记录类目数"].includes(r[0]));
      meta.push(["商品数据版本",info.queryVersion]);
      meta.push(["商品源更新时间",info.sourceUpdated]);
      if (info.unavailableCategories?.length) meta.push(["无记录类目数",info.unavailableCategories.length]);
    }
    let section = $("trend-products");
    if (!section) {
      $("trend-results").insertAdjacentHTML(
        "beforeend",
        '<section class="panel" id="trend-products"></section>',
      );
      section = $("trend-products");
    }
    const old = info.oldTop || [],
      now = info.top || [],
      n = Math.max(now.length, old.length),
      sum = (a) => a.reduce((s, v) => s + v.g, 0);
    const data = (v) => [
      v?.brand || "",
      v ? PLATFORMS[v.p] + " · " + v.name : "",
      v?.g ?? null,
      v?.share ?? null,
    ];
    rowsByName.products = [
      [
        "排名",
        filter.endYear + "品牌",
        "商品名称",
        "GMV（元）",
        "市占率（小数）",
        filter.endYear - 1 + "品牌",
        "商品名称",
        "GMV（元）",
        "市占率（小数）",
      ],
      ...Array.from({ length: n }, (_, i) => [
        i + 1,
        ...data(now[i]),
        ...data(old[i]),
      ]),
      [
        "TOP10合计",
        "",
        "",
        sum(now),
        ratio(sum(now), info.total),
        "",
        "",
        sum(old),
        ratio(sum(old), info.oldTotal),
      ],
    ];
    percentByName.products = [4, 8];
    section.innerHTML = `<h2>④ TOP10商品</h2><p class="trend-summary">${info.products ? `当期${filter.rule ? "命中" : "收录"} ${info.products} 个商品；TOP10占比 ${percent(ratio(sum(now), info.total))}。` : "当期无命中商品。"}${filter.rule ? esc(info.rule) : "商品源口径"}</p>${buttons("products")}<div class="trend-table-wrap"><table class="trend-data products-table"><thead><tr><th rowspan="2">排名</th><th colspan="4">${filter.endYear}年1—${filter.cutoff}月 TOP10商品</th><th colspan="4">${filter.endYear - 1}年1—${filter.cutoff}月 TOP10商品</th></tr><tr>${["品牌", "商品名称", "GMV", "市占率", "品牌", "商品名称", "GMV", "市占率"].map((v) => `<th>${v}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td>${[now[i], old[i]].map((v) => `<td>${esc(v?.brand || "—")}</td><td class="product-name" title="${esc(v?.name || "")}">${esc(v?.name || "—")}<br><small>${v ? PLATFORMS[v.p] : ""}</small></td><td>${number(v?.g)}</td><td>${dataBar(v?.share)}</td>`).join("")}</tr>`).join("")}<tr class="trend-total"><th>合计</th><th colspan="2">TOP10</th><td>${number(sum(now))}</td><td>${percent(ratio(sum(now), info.total))}</td><th colspan="2">TOP10</th><td>${number(sum(old))}</td><td>${percent(ratio(sum(old), info.oldTotal))}</td></tr></tbody></table></div>`;
    if (prices) {
      $("trend-status").dataset.ready = "true";
      $("trend-status").textContent = "已生成，页面与下载范围一致";
      $("trend-print").disabled = false;
    }
  }
  function brandsReady(b) {
    brands = b;
    kpis();
    const now = `${filter.endYear}年1—${filter.cutoff}月`,
      old = `${filter.endYear - 1}年1—${filter.cutoff}月`;
    const structure = platformMix;
    const headers = [
      "序号",
      now + "品牌",
      "GMV（元）",
      "市占率（小数）",
      ...filter.plats.map((p) => PLATFORMS[p] + "占比（小数）"),
      old + "品牌",
      "GMV（元）",
      "市占率（小数）",
      ...filter.plats.map((p) => PLATFORMS[p] + "占比（小数）"),
    ];
    const cells = (v) => [
      v?.name || "",
      v?.g ?? null,
      v?.share ?? null,
      ...filter.plats.map((p) => ratio(v?.plats[p], v?.g)),
    ];
    const n = Math.max(b.top.length, b.oldTop.length),
      sum = (vs) => (vs.length ? vs.reduce((s, v) => s + v.g, 0) : null);
    rowsByName.competition = [
      headers,
      ...Array.from({ length: n }, (_, i) => [
        i + 1,
        ...cells(b.top[i]),
        ...cells(b.oldTop[i]),
      ]),
      [
        "TOP5合计",
        "",
        sum(b.top),
        b.cr5,
        ...filter.plats.map(() => null),
        "",
        sum(b.oldTop),
        b.priorCr5,
        ...filter.plats.map(() => null),
      ],
    ];
    percentByName.competition = headers.flatMap((v, i) =>
      v.includes("小数") ? [i] : [],
    );
    const d = b.cr5 !== null && b.priorCr5 !== null ? b.cr5 - b.priorCr5 : null;
    $("trend-competition").innerHTML =
      `<h2>③ 竞争格局</h2><p class="trend-summary">CR5 ${percent(b.cr5)}，较同期变化 ${pp(d)}；${b.top[0] ? `${esc(b.top[0].name)}居首，份额 ${percent(b.top[0].share)}。` : "暂无已识别品牌。"}</p>${buttons("competition")}<div class="trend-table-wrap"><table class="trend-competition"><thead><tr><th rowspan="2">序号</th><th colspan="4">${now} TOP5品牌</th><th colspan="4">${old} TOP5品牌</th></tr><tr>${["品牌", "GMV", "市占率", "平台结构", "品牌", "GMV", "市占率", "平台结构"].map((v) => `<th>${v}${v === "平台结构" ? platformLegend() : ""}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: n }, (_, i) => `<tr><td>${i + 1}</td>${[b.top[i], b.oldTop[i]].map((v) => `<td>${esc(v?.name || "—")}</td><td>${number(v?.g)}</td><td>${dataBar(v?.share)}</td><td class="platform-structure">${structure(v)}</td>`).join("")}</tr>`).join("")}<tr class="trend-total"><th>合计</th><th>TOP5</th><td>${number(sum(b.top))}</td><td>${percent(b.cr5)}</td><td>—</td><th>TOP5</th><td>${number(sum(b.oldTop))}</td><td>${percent(b.priorCr5)}</td><td>—</td></tr></tbody></table></div>`;
  }
  function pricesReady(p) {
    prices = p;
    renderPrices();
    $("trend-status").textContent =
      ctx.manifest.products && !productInfo
        ? "指标已生成，正在加载TOP商品…"
        : productInfo?.currentRecords === 0 ? "当期未命中商品：请调整打标规则或类目范围" : `已生成，页面与下载范围一致${productInfo?.unavailableCategories?.length ? `（${productInfo.unavailableCategories.length}个类目在查询时段无记录）` : ""}`;
    $("trend-status").dataset.ready = String(
      !ctx.manifest.products || !!productInfo,
    );
    $("trend-print").disabled = !!ctx.manifest.products && !productInfo;
    $("trend-generate").disabled = false;
  }
  function renderPrices() {
    const p = prices;
    if (!p) return;
    const mode = priceMode === "share";
    const header = [
      "价格带",
      "GMV（元）",
      "同比（小数）",
      "占比（小数）",
      "占比变化（比例差）",
      ...Array.from({ length: 5 }, (_, i) => [
        "TOP" + (i + 1) + "品牌",
        "品牌GMV（元）",
        "带内品牌份额（小数）",
      ]).flat(),
    ];
    rowsByName.prices = [
      header,
      ...p.bands.map((v) => [
        v.name,
        v.g,
        v.y,
        v.share,
        v.change,
        ...Array.from({ length: 5 }, (_, i) => [
          v.brands.top[i]?.name || "",
          v.brands.top[i]?.g ?? null,
          v.brands.top[i]?.share ?? null,
        ]).flat(),
      ]),
      [
        "合计",
        p.total.g,
        p.total.y,
        p.total.g > 0 ? 1 : null,
        null,
        ...Array(15).fill(null),
      ],
    ];
    percentByName.prices = [2, 3, 4, 7, 10, 13, 16, 19];
    const main = p.bands
        .filter((v) => v.band >= 0 && v.g > 0)
        .sort((a, b) => b.g - a.g)[0],
      up = p.bands
        .filter((v) => v.band >= 0 && v.change > 0)
        .sort((a, b) => b.change - a.change)[0];
    $("trend-prices").innerHTML =
      `<h2>② 细分价格带</h2><p class="trend-summary">${main ? `${esc(main.name)}为主力价格带，占比 ${percent(main.share)}${main.brands.top[0] ? `，带内领先品牌为${esc(main.brands.top[0].name)}` : ""}。${up ? `${esc(up.name)}份额提升 ${pp(up.change)}。` : ""}` : "所选范围暂无价格带记录。"}</p><div class="toolbar"><label>TOP品牌指标 <select id="price-mode"><option value="gmv" ${!mode ? "selected" : ""}>GMV</option><option value="share" ${mode ? "selected" : ""}>带内品牌份额</option></select></label></div><p class="note">${filter.rule || localSQL ? "命中商品口径 · 品牌份额以该价格带全部命中商品为分母" : `价格表覆盖行业GMV ${percent(ratio(p.total.g, market.kpi.g))} · 带内品牌份额按品牌价格表`}</p>${buttons("prices")}<div class="trend-table-wrap"><table class="trend-data"><thead><tr><th rowspan="2">价格带（元）</th><th colspan="4">价格带分布</th><th colspan="5">价格带TOP5品牌 · ${mode ? "带内品牌份额" : "GMV"}</th></tr><tr><th>GMV</th><th>同比</th><th>占比</th><th>占比变化</th>${[1, 2, 3, 4, 5].map((i) => `<th>TOP${i}</th>`).join("")}</tr></thead><tbody>${p.bands
        .map(
          (v) =>
            `<tr><td>${esc(v.name)}</td><td>${number(v.g)}</td><td>${dataBar(v.y, percent, Math.max(...p.bands.map((x) => Math.abs(x.y || 0)), 0.001), true)}</td><td>${dataBar(v.share)}</td><td>${dataBar(v.change, pp, Math.max(...p.bands.map((x) => Math.abs(x.change || 0)), 0.001), true)}</td>${Array.from(
              { length: 5 },
              (_, i) => {
                const b = v.brands.top[i];
                return `<td>${b ? `${esc(b.name)}<br><strong>${mode ? percent(b.share) : number(b.g)}</strong><br><small>${mode ? "GMV " + number(b.g) : "市占率 " + dataBar(b.share)}</small>` : "—"}</td>`;
              },
            ).join("")}</tr>`,
        )
        .join(
          "",
        )}<tr class="trend-total"><th>合计</th><td>${number(p.total.g)}</td><td>${percent(p.total.y)}</td><td>${p.total.g > 0 ? "100.00%" : "—"}</td><td colspan="6">—</td></tr></tbody></table></div>`;
    $("price-mode").onchange = () => {
      priceMode = $("price-mode").value;
      renderPrices();
      if (dirty)
        host
          .querySelectorAll("[data-trend-download]")
          .forEach((b) => (b.disabled = true));
    };
  }
  active = {
    host,
    onMessage: (m) => {
      if (
        m.id !== currentId ||
        m.id !== job ||
        !host.isConnected ||
        !ctx.isCurrent()
      )
        return;
      if (m.progress) {
        $("trend-status").textContent = m.progress;
        return;
      }
      if (m.error) {
        $("trend-status").textContent = m.error + "，可重新生成";
        $("trend-generate").disabled = false;
        return;
      }
      if (m.market) marketReady(m.market);
      if (m.products) productsReady(m.products);
      if (m.brands) brandsReady(m.brands);
      if (m.prices) pricesReady(m.prices);
    },
  };
  if (!worker) {
    worker = new Worker(new URL("./trend-worker.js?v=2.7.0", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => active?.onMessage(data);
    worker.onerror = () => {
      active?.onMessage({ id: job, error: "计算失败，请重新进入本页" });
      worker.terminate();
      worker = null;
    };
  }
  if (
    initializedIndustry !== ctx.industry ||
    initializedManifest !== ctx.manifest ||
    !worker.__initialized
  ) {
    worker.postMessage({
      type: "init",
      industry: ctx.industry,
      manifest: ctx.manifest,
    });
    initializedIndustry = ctx.industry;
    initializedManifest = ctx.manifest;
    worker.__initialized = true;
  }
  $("trend-generate").onclick = () => {
    if ((state.ruleDraft || "") !== (state.confirmedRule?.text || "")) {
      $("trend-status").textContent = "请先核对并确认打标规则";
      return;
    }
    filter = {
      ids: [...state.ids].filter(id => cats.some(c => c.id === id)).sort(),
      startYear: state.startYear,
      endYear: state.endYear,
      cutoff: state.cutoff,
      plats: [...state.plats],
      name: state.name.trim() || "自定义行业",
      rule: state.confirmedRule?.text ? { ...state.confirmedRule } : null,
    };
    if (
      !filter.ids.length ||
      !filter.plats.length ||
      filter.startYear > filter.endYear ||
      filter.endYear * 100 + filter.cutoff > ctx.manifest.last
    ) {
      $("trend-status").textContent = "请选择有效类目、平台和时段";
      return;
    }
    invalidate();
    $("trend-results").replaceChildren();
    currentId = ++job;
    $("trend-generate").disabled = true;
    $("trend-status").textContent = "正在生成…";
    meta = [
      [
        "类目范围",
        cats
          .filter((c) => state.ids.has(c.id))
          .map((c) => c.path.join(" / "))
          .join("；"),
      ],
      ["平台", filter.plats.map((p) => PLATFORMS[p]).join("/")],
      ["自定义行业", filter.name],
      [
        "时段",
        `${filter.startYear}—${filter.endYear}年，末年至${filter.cutoff}月`,
      ],
      ["数据版本", ctx.manifest.version],
      [
        "口径",
        "GMV退后；规模按行业表、价格带按价格表、品牌份额按对应品牌表；同比共同记录；数值为元/件，比例为小数",
      ],
    ];
    if (ctx.manifest.products && !localSQL)
      meta.push(["商品快照", ctx.manifest.products.assetCommit]);
    if (filter.rule || localSQL) {
      meta.push(
        ["打标规则", filter.rule?.text || "所选类目全部商品"],
        [
          "商品口径",
          "全部指标基于命中商品；按各期商品名称匹配；同比为共同类目月份平台",
        ],
      );
      meta[meta.findIndex((r) => r[0] === "口径")][1] =
        "GMV退后；规模、价格带与品牌均按命中商品同源计算；元/件，比例为小数";
    }
    if (worker)
      worker.postMessage({
        type: "generate",
        id: currentId,
        filter,
      });
    else {
      $("trend-status").textContent = "请重新进入本页重试";
      $("trend-generate").disabled = false;
    }
  };
  $("trend-print").onclick = () => {
    if (!dirty) window.print();
  };
  host.onclick = (e) => {
    const b = e.target.closest("[data-trend-download]");
    if (!b || b.disabled || dirty) return;
    const key = b.dataset.trendDownload,
      format = b.dataset.format,
      model = models[key],
      rows = model ? rawRows(model) : rowsByName[key];
    if (!rows) return;
    const names = {
      kpis: "核心指标",
      platforms: "平台规模与结构",
      prices: "细分价格带",
      competition: "竞争格局",
      products: "TOP10商品同期对照",
    };
    const file =
      `${filter.name}_${model?.title || names[key]}_${filter.startYear}-${filter.endYear}_${filter.cutoff}月`.replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
    const exportMeta =
      key === "prices"
        ? [
            ...meta,
            ["价格表覆盖行业GMV（小数）", ratio(prices.total.g, market.kpi.g)],
          ]
        : meta;
    const blob =
      format === "svg"
        ? new Blob([chartSVG(model)], { type: "image/svg+xml;charset=utf-8" })
        : format === "xlsx"
          ? editableWorkbook({
              model,
              rows,
              metadata: exportMeta,
              percentColumns: percentByName[key] || [],
            })
          : new Blob([csv([...exportMeta, [], ...rows])], {
              type: "text/csv;charset=utf-8",
            });
    download(blob, file + "." + format);
    $("trend-status").textContent = "已下载 " + file + "." + format;
  };
}
export function cancelTrends() {
  ++job;
  worker?.postMessage({ type: "cancel" });
  active = null;
}
