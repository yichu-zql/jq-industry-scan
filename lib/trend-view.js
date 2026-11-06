import { PLATFORMS, csv } from "./metrics.js";
import { number, percent } from "./trend-model.js?v=2.4.0";
import { esc, chartSVG, chartTable, rawRows } from "./trend-chart.js?v=2.4.0";
import { editableWorkbook } from "./trend-export.js?v=2.4.0";
let worker,
  job = 0,
  active = null,
  saved = null;
const signed = (v) =>
  Number.isFinite(v) ? (v > 0 ? "+" : "") + percent(v) : "—";
function download(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const table = (rows) =>
  `<div class="trend-table-wrap"><table class="trend-data"><thead><tr>${rows[0].map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>${rows
    .slice(1)
    .map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
export function mountTrends(ctx) {
  const host = ctx.element,
    first = Math.floor(ctx.manifest.first / 100),
    last = Math.floor(ctx.manifest.last / 100),
    initial = ctx.ids.length
      ? ctx.ids
      : ctx.industry.categories
          .filter((c) => c.path[0] === ctx.industry.categories[0].path[0])
          .map((c) => c.id);
  const state = saved || {
    ids: new Set(initial),
    startYear: Math.max(first, last - 3),
    endYear: last,
    cutoff: ctx.manifest.last % 100,
    plats: [...ctx.plats],
    depth: "",
    top: 6,
  };
  saved = state;
  const cats = ctx.industry.categories,
    roots = [...new Set(cats.map((c) => c.path[0]))];
  host.innerHTML = `<section class="panel trend-controls"><h2>行业趋势速览</h2><p class="note">本页独立筛选，支持跨行业组合；生成后同步图表、数据和下载。</p><details id="trend-picker"><summary id="trend-count"></summary><div class="toolbar"><label>一级类目 <select id="trend-root">${roots.map((v) => `<option>${esc(v)}</option>`).join("")}</select></label><label>二级类目 <select id="trend-second"></select></label><input id="trend-search" type="search" aria-label="搜索三级类目" placeholder="搜索三级类目"><button id="trend-add">选中此范围</button><button id="trend-remove">取消此范围</button><button id="trend-clear">清空全部</button></div><div id="trend-leaves"></div></details><div class="toolbar"><label>起始年份 <select id="trend-start">${Array.from({ length: last - first + 1 }, (_, i) => `<option>${first + i}</option>`).join("")}</select></label><label>截止年份 <select id="trend-end">${Array.from({ length: last - first + 1 }, (_, i) => `<option>${first + i}</option>`).join("")}</select></label><label>末年截至 <select id="trend-cutoff">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}月</option>`).join("")}</select></label>${PLATFORMS.map((v, i) => `<label><input type="checkbox" data-trend-plat value="${i}" ${state.plats.includes(i) ? "checked" : ""}>${v}</label>`).join("")}<label>细分维度 <select id="trend-depth"><option value="">自动</option><option value="1">一级类目</option><option value="2">二级类目</option><option value="3">三级类目</option></select></label><label>显示 <select id="trend-top"><option value="6">TOP6＋其他</option><option value="10">TOP10＋其他</option></select></label></div><div class="toolbar"><button id="trend-generate" class="primary">生成速览</button><button id="trend-print" disabled>打印 / 保存PDF</button><span id="trend-status" role="status">选择分析范围后生成。</span></div><p class="note">金额：GMV（退后）；规模用行业表，品牌份额用同源品牌表。同比按共同记录比较；CSV比例以小数保存。<span id="trend-range"></span></p></section><div class="trend-report" id="trend-results"></div>`;
  const $ = (id) => host.querySelector("#" + id);
  let filter = null,
    models = {},
    brands = null,
    meta = [],
    rowsByName = {},
    dirty = true,
    currentId = 0;
  const count = () => {
    $("trend-count").textContent =
      `类目范围：已选 ${state.ids.size} 个三级类目（点击调整）`;
  };
  const visible = () =>
    cats.filter(
      (c) =>
        c.path[0] === $("trend-root").value &&
        (!$("trend-second").value || c.path[1] === $("trend-second").value) &&
        c.path
          .join(" / ")
          .toLowerCase()
          .includes($("trend-search").value.trim().toLowerCase()),
    );
  function leaves() {
    const shown = visible();
    $("trend-leaves").innerHTML =
      shown
        .map(
          (c) =>
            `<label><input type="checkbox" data-trend-cat="${c.id}" ${state.ids.has(c.id) ? "checked" : ""}>${esc(c.path.slice(1).join(" / "))}</label>`,
        )
        .join("") || '<p class="note">没有匹配的类目</p>';
    count();
  }
  function seconds() {
    const values = [
      ...new Set(
        cats
          .filter((c) => c.path[0] === $("trend-root").value)
          .map((c) => c.path[1]),
      ),
    ];
    $("trend-second").innerHTML =
      '<option value="">全部二级</option>' +
      values.map((v) => `<option>${esc(v)}</option>`).join("");
    leaves();
  }
  function invalidate() {
    dirty = true;
    $("trend-print").disabled = true;
    ++job;
    worker?.postMessage({ type: "cancel" });
    $("trend-status").textContent = "条件已调整，请重新生成；下方为上次结果。";
    $("trend-generate").disabled = false;
    $("trend-results").classList.add("outdated");
    host
      .querySelectorAll("[data-trend-download]")
      .forEach((b) => (b.disabled = true));
  }
  $("trend-root").value =
    cats.find((c) => state.ids.has(c.id))?.path[0] || roots[0];
  seconds();
  $("trend-root").onchange = seconds;
  $("trend-second").onchange = leaves;
  let searchTimer;
  $("trend-search").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(leaves, 120);
  };
  $("trend-leaves").onchange = (e) => {
    const id = e.target.dataset.trendCat;
    if (!id) return;
    e.target.checked ? state.ids.add(id) : state.ids.delete(id);
    count();
    invalidate();
  };
  $("trend-add").onclick = () => {
    visible().forEach((c) => state.ids.add(c.id));
    leaves();
    invalidate();
  };
  $("trend-remove").onclick = () => {
    visible().forEach((c) => state.ids.delete(c.id));
    leaves();
    invalidate();
  };
  $("trend-clear").onclick = () => {
    state.ids.clear();
    leaves();
    invalidate();
  };
  for (const [id, key] of [
    ["trend-start", "startYear"],
    ["trend-end", "endYear"],
    ["trend-cutoff", "cutoff"],
    ["trend-depth", "depth"],
    ["trend-top", "top"],
  ]) {
    $(id).value = state[key];
    $(id).onchange = () => {
      state[key] = key === "depth" ? $(id).value : +$(id).value;
      if (key === "endYear") {
        state.cutoff =
          state.endYear === last
            ? Math.min(state.cutoff, ctx.manifest.last % 100)
            : state.cutoff;
        $("trend-cutoff").value = state.cutoff;
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
  const buttons = (name, chart = false) =>
    `<div class="trend-downloads">${chart ? `<button data-trend-download="${name}" data-format="xlsx">下载可编辑图表 Excel</button><button data-trend-download="${name}" data-format="svg">下载矢量图 SVG</button>` : `<button data-trend-download="${name}" data-format="xlsx">下载可编辑表格 Excel</button>`}<button data-trend-download="${name}" data-format="csv">下载原始数据 CSV</button></div>`;
  function marketReady(m) {
    models = { channels: m.channels, categories: m.categories };
    $("trend-results").innerHTML =
      `<section class="panel"><h2>① 市场规模</h2><p class="note">${esc([...new Set(cats.filter((c) => filter.ids.includes(c.id)).map((c) => c.path[0]))].join(" / "))} · ${filter.ids.length}个三级类目 · ${esc(meta[1][1])}</p>${Object.entries(
        models,
      )
        .map(
          ([key, v]) =>
            `<article class="trend-chart"><h3>${esc(v.title)}</h3>${buttons(key, true)}<div class="trend-svg">${chartSVG(v)}</div>${chartTable(v)}</article>`,
        )
        .join(
          "",
        )}</section><section class="panel" id="trend-competition"><h2>② 竞争格局</h2><p>品牌证据加载中，规模图已可查看和下载。</p></section><section class="panel" id="trend-highlights"><h2>③ 竞品亮点</h2><p class="note">等待同范围品牌证据。</p></section>`;
    $("trend-results").classList.remove("outdated");
    $("trend-range").textContent =
      ` 本次：${filter.startYear}—${filter.endYear}年（末年至${filter.cutoff}月）· ${filter.ids.length}个三级类目。`;
    $("trend-status").textContent = "规模图已生成，正在计算品牌格局…";
    dirty = false;
  }
  function brandsReady(b) {
    brands = b;
    const current = `${filter.endYear}年1—${filter.cutoff}月`,
      prior = `${filter.endYear - 1}年1—${filter.cutoff}月`,
      delta = b.cr5 !== null && b.priorCr5 !== null ? b.cr5 - b.priorCr5 : null;
    const body = Array.from({ length: 5 }, (_, i) => {
      const a = b.oldTop[i],
        c = b.top[i];
      return `<tr><td>${i + 1}</td><td>${esc(a?.name || "—")}</td><td>${number(a?.g)}</td><td>${percent(a?.share)}</td><td>${esc(c?.name || "—")}${c?.newTop ? " <small>新进</small>" : ""}</td><td>${number(c?.g)}</td><td>${percent(c?.share)}</td></tr>`;
    }).join("");
    rowsByName.competition = [
      [
        "排名",
        prior + "品牌",
        "GMV（元）",
        "市占率（小数）",
        current + "品牌",
        "GMV（元）",
        "市占率（小数）",
      ],
      ...Array.from({ length: 5 }, (_, i) => [
        i + 1,
        b.oldTop[i]?.name || "",
        b.oldTop[i]?.g ?? null,
        b.oldTop[i]?.share ?? null,
        b.top[i]?.name || "",
        b.top[i]?.g ?? null,
        b.top[i]?.share ?? null,
      ]),
      [
        "TOP5合计",
        "",
        b.oldTop.length ? b.oldTop.reduce((s, v) => s + v.g, 0) : null,
        b.priorCr5,
        "",
        b.top.length ? b.top.reduce((s, v) => s + v.g, 0) : null,
        b.cr5,
      ],
    ];
    $("trend-competition").innerHTML =
      `<h2>② 竞争格局</h2><p>${prior} VS ${current} · CR5 ${percent(b.priorCr5)} → ${percent(b.cr5)}${delta !== null ? `，${delta >= 0 ? "提升" : "下降"} ${Math.abs(delta * 100).toFixed(2)}pp` : ""}。</p>${buttons("competition")}<div class="trend-table-wrap"><table class="trend-competition"><thead><tr><th colspan="4">${prior} TOP5品牌</th><th colspan="3">${current} TOP5品牌</th></tr><tr><th>序号</th><th>品牌</th><th>GMV（元）</th><th>市占率</th><th>品牌</th><th>GMV（元）</th><th>市占率</th></tr></thead><tbody>${body}<tr class="trend-total"><th colspan="2">TOP5合计</th><td>${number(rowsByName.competition.at(-1)[2])}</td><td>${percent(b.priorCr5)}</td><th>TOP5合计</th><td>${number(rowsByName.competition.at(-1)[5])}</td><td>${percent(b.cr5)}</td></tr></tbody></table></div>`;
    const insights = b.highlights.map((v) => ({
      name: v.name,
      lines: [
        `GMV ${number(v.g)}，已入库同比 ${signed(v.y)}；市占率 ${percent(v.share)}，${v.shareChange === null ? "同期份额不足以比较" : `变化 ${(v.shareChange * 100).toFixed(2)}pp`}。`,
        v.gain
          ? v.gain.delta > 0
            ? `${PLATFORMS[v.gain.p]}贡献最大正增量 ${number(v.gain.delta)}；需继续验证该渠道增长的持续性。`
            : `可比平台均未贡献正增量；${PLATFORMS[v.mainPlatform]}为当前主要成交渠道。`
          : `主要成交渠道：${PLATFORMS[v.mainPlatform] || "—"}；暂不推断渠道增量。`,
      ],
    }));
    rowsByName.highlights = [
      [
        "品牌",
        "GMV（元）",
        "已入库同比（小数）",
        "份额（小数）",
        "份额变化（比例差）",
        "主要渠道",
        "数据亮点",
      ],
      ...b.highlights.map((v, i) => [
        v.name,
        v.g,
        v.y,
        v.share,
        v.shareChange,
        PLATFORMS[v.mainPlatform] || "",
        insights[i].lines.join(" "),
      ]),
    ];
    $("trend-highlights").innerHTML =
      `<h2>③ 竞品亮点</h2>${buttons("highlights")}${insights.map((v) => `<article><h3>${esc(v.name)}</h3>${v.lines.map((t) => `<p>${esc(t)}</p>`).join("")}</article>`).join("") || "<p>所选范围暂无已识别品牌。</p>"}<p class="note">仅提炼已有规模、份额及渠道证据，不推断未核实的商品卖点、私域或费用投入。</p>`;
    $("trend-status").textContent = "已生成：图表、品牌格局及下载范围一致。";
    $("trend-status").dataset.ready = "true";
    $("trend-print").disabled = false;
    $("trend-generate").disabled = false;
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
      if (m.error) {
        $("trend-status").textContent = m.error + " 可点击生成重试。";
        $("trend-generate").disabled = false;
        return;
      }
      if (m.market) marketReady(m.market);
      if (m.brands) brandsReady(m.brands);
    },
  };
  if (!worker) {
    worker = new Worker(new URL("./trend-worker.js?v=2.4.0", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data: m }) => active?.onMessage(m);
    worker.onerror = () => {
      if (active?.host.isConnected)
        active.onMessage({ id: job, error: "后台计算失败" });
      worker.terminate();
      worker = null;
    };
  }
  worker.postMessage({ type: "init", industry: ctx.industry });
  $("trend-generate").onclick = () => {
    filter = {
      ids: [...state.ids].sort(),
      startYear: state.startYear,
      endYear: state.endYear,
      cutoff: state.cutoff,
      plats: [...state.plats],
      depth: state.depth,
      top: state.top,
    };
    if (
      !filter.ids.length ||
      !filter.plats.length ||
      filter.startYear > filter.endYear ||
      filter.endYear * 100 + filter.cutoff > ctx.manifest.last
    ) {
      $("trend-status").textContent =
        "请选择有效类目、平台及数据截止范围内的年份月份。";
      return;
    }
    invalidate();
    currentId = ++job;
    $("trend-generate").disabled = true;
    $("trend-status").dataset.ready = "false";
    $("trend-status").textContent = "正在生成规模趋势…";
    const names = cats
      .filter((c) => state.ids.has(c.id))
      .map((c) => c.path.join(" / "));
    meta = [
      ["类目范围", names.join("；")],
      ["平台", filter.plats.map((p) => PLATFORMS[p]).join("/")],
      [
        "展示时段",
        `${filter.startYear}—${filter.endYear}年，末年至${filter.cutoff}月`,
      ],
      ["数据版本", ctx.manifest.version],
      ["数据截止", ctx.manifest.last],
      ["来源", "久谦；规模：行业表；品牌份额：品牌表；GMV退后；比例以小数存储"],
      [
        "图表编辑",
        "原始数据GMV控制柱体；可比本期、同期GMV控制同比折线。首次展示年不绘制同比。",
      ],
    ];
    if (!worker) {
      $("trend-status").textContent = "请切换页面后重新进入速览重试。";
      $("trend-generate").disabled = false;
      return;
    }
    worker.postMessage({
      type: "generate",
      id: currentId,
      filter,
      manifest: ctx.manifest,
    });
  };
  $("trend-print").onclick = () => {
    if (!dirty) window.print();
  };
  host.onclick = (e) => {
    const b = e.target.closest("[data-trend-download]");
    if (!b || b.disabled || dirty) return;
    const name = b.dataset.trendDownload,
      format = b.dataset.format,
      model = models[name],
      rows = model ? rawRows(model) : rowsByName[name];
    if (!rows) return;
    const file =
      (model?.title ||
        { competition: "竞争格局", highlights: "竞品亮点" }[name]) +
      "_" +
      filter.startYear +
      "-" +
      filter.endYear +
      "_" +
      filter.cutoff +
      "月";
    let blob;
    if (format === "svg")
      blob = new Blob([chartSVG(model)], {
        type: "image/svg+xml;charset=utf-8",
      });
    else if (format === "xlsx")
      blob = editableWorkbook({
        model,
        rows,
        metadata: meta,
        percentColumns: name === "competition" ? [3, 6] : [2, 3, 4],
      });
    else
      blob = new Blob([csv([...meta, [], ...rows])], {
        type: "text/csv;charset=utf-8",
      });
    download(blob, file + "." + format);
    $("trend-status").textContent =
      "已下载当前范围的" + file + "（" + format.toUpperCase() + "）。";
  };
}
export function cancelTrends() {
  ++job;
  worker?.postMessage({ type: "cancel" });
  active = null;
}
