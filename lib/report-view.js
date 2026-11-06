import { PRICE, PLATFORMS, shift } from "./metrics.js";
import { drawReport, imagePDF } from "./report-render.js?v=2.4.0";
import { reportRules } from "./report-model.js?v=2.4.0";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ym = (v) => String(v).slice(0, 4) + "-" + String(v).slice(4),
  month = (v) => Number(v.replace("-", ""));
let dialog,
  worker,
  seq = 0,
  context,
  result,
  canvas,
  meta,
  dirty = true,
  lastKey = "";
const $ = (id) => dialog.querySelector("#" + id);
function pathOf(cats) {
  if (!cats.length) return [];
  const path = [...cats[0].path];
  while (
    path.length &&
    !cats.every((c) => path.every((v, i) => c.path[i] === v))
  )
    path.pop();
  return path;
}
function scope() {
  const root = $("brief-root").value,
    second = $("brief-second").value,
    leaf = $("brief-leaf").value;
  return context.categories.filter(
    (c) =>
      (root === "current" ? context.ids.includes(c.id) : c.path[0] === root) &&
      (!second || c.path[1] === second) &&
      (!leaf || c.id === leaf),
  );
}
function selectors(reset = false) {
  const root = $("brief-root").value,
    cats = context.categories.filter((c) =>
      root === "current" ? context.ids.includes(c.id) : c.path[0] === root,
    );
  const old = reset ? "" : $("brief-second").value;
  $("brief-second").innerHTML =
    '<option value="">全部二级</option>' +
    [...new Set(cats.map((c) => c.path[1]))]
      .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`)
      .join("");
  $("brief-second").value = old;
  if (!$("brief-second").value) $("brief-second").value = "";
  leaves();
}
function leaves() {
  const root = $("brief-root").value,
    second = $("brief-second").value;
  const cats = context.categories.filter(
    (c) =>
      (root === "current" ? context.ids.includes(c.id) : c.path[0] === root) &&
      (!second || c.path[1] === second),
  );
  $("brief-leaf").innerHTML =
    '<option value="">全部三级</option>' +
    cats
      .map((c) => `<option value="${c.id}">${esc(c.path[2])}</option>`)
      .join("");
}
function invalidate() {
  dirty = true;
  ++seq;
  worker?.postMessage({ type: "cancel" });
  $("brief-status").textContent = "筛选已调整，点击“生成概览”更新。";
  $("brief-generate").disabled = false;
  $("brief-pdf").disabled = $("brief-png").disabled = true;
  $("brief-preview").classList.add("outdated");
}
function dates() {
  const mode = $("brief-period").value,
    end = month($("brief-end").value);
  if (mode === "mat")
    $("brief-start").value = ym(
      Math.max(context.manifest.first, shift(end, -11)),
    );
  if (mode === "year")
    $("brief-start").value = ym(Math.floor(end / 100) * 100 + 1);
  if (mode.startsWith("year:")) {
    const year = +mode.split(":")[1];
    $("brief-start").value = ym(
      Math.max(context.manifest.first, year * 100 + 1),
    );
    $("brief-end").value = ym(Math.min(context.manifest.last, year * 100 + 12));
  }
  $("brief-start").disabled = mode !== "custom";
}
function getFilter() {
  const cats = scope();
  return {
    ids: cats.map((c) => c.id).sort(),
    path: pathOf(cats),
    plats: [...dialog.querySelectorAll("[data-brief-platform]:checked")].map(
      (c) => +c.value,
    ),
    bands: [...dialog.querySelectorAll("[data-brief-band]:checked")].map(
      (c) => +c.value,
    ),
    start: month($("brief-start").value),
    end: month($("brief-end").value),
  };
}
function generate() {
  dates();
  const filter = getFilter();
  if (
    !filter.ids.length ||
    !filter.plats.length ||
    !filter.start ||
    !filter.end ||
    filter.start > filter.end ||
    filter.start < context.manifest.first ||
    filter.end > context.manifest.last
  ) {
    $("brief-status").textContent =
      "请选择有效类目、至少一个平台和数据范围内的起止月份。";
    return;
  }
  if (!worker) {
    worker = new Worker(
      new URL("./report-worker.js?v=2.4.0", import.meta.url),
      {
        type: "module",
      },
    );
    worker.onmessage = ({ data: m }) => {
      if (m.id !== seq || !dialog.open) return;
      if (m.error) {
        $("brief-status").textContent = m.error;
        $("brief-generate").disabled = false;
        return;
      }
      result = m.result;
      canvas = document.createElement("canvas");
      const f = result.filter;
      const title =
        f.path.join(" / ") || $("brief-root").selectedOptions[0].textContent;
      meta = {
        title,
        period: ym(f.start) + "—" + ym(f.end),
        bands: f.bands.length
          ? f.bands.map((b) => (b < 0 ? "未定价" : PRICE[b] + "元")).join(" / ")
          : "全部价格带",
        platforms: f.plats.map((p) => PLATFORMS[p]).join("/"),
        last: ym(context.manifest.last),
        version: context.manifest.version,
        created:
          new Date().toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour12: false,
          }) + " 北京时间",
      };
      try {
        const narrative = drawReport(canvas, result, meta);
        $("brief-preview").innerHTML = "";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", title + "：" + narrative.headline);
        $("brief-preview").append(canvas);
        $("brief-text").textContent = [
          narrative.headline,
          ...narrative.lines,
        ].join("\n");
        dirty = false;
        $("brief-preview").classList.remove("outdated");
        $("brief-pdf").disabled = $("brief-png").disabled = false;
        $("brief-status").textContent =
          `已生成 · ${f.ids.length}个三级类目 · ${result.candidateCount}个机会候选`;
        $("brief-status").dataset.ready = "true";
      } catch (e) {
        $("brief-status").textContent = "预览生成失败：" + e.message;
      }
      $("brief-generate").disabled = false;
    };
    worker.onerror = () => {
      $("brief-status").textContent = "加载失败，请重新生成。";
      $("brief-generate").disabled = false;
      worker.terminate();
      worker = null;
    };
  }
  dirty = true;
  const id = ++seq;
  $("brief-generate").disabled = true;
  $("brief-pdf").disabled = $("brief-png").disabled = true;
  $("brief-status").dataset.ready = "false";
  $("brief-status").textContent = "正在汇总所选范围并核对机会证据…";
  $("brief-preview").classList.add("outdated");
  worker.postMessage({
    type: "report",
    id,
    manifest: context.manifest,
    categories: context.categories,
    filter,
  });
}
async function download(type) {
  if (dirty || !canvas) return;
  const snapshot = canvas,
    name =
      meta.title.slice(0, 55).replace(/[\\/:*?"<>|]/g, "-") +
      "_" +
      result.filter.start +
      "-" +
      result.filter.end;
  const blob = await new Promise((resolve) =>
    snapshot.toBlob(resolve, type === "pdf" ? "image/jpeg" : "image/png", 0.95),
  );
  if (!blob) {
    $("brief-status").textContent = "导出失败，请重试。";
    return;
  }
  const file =
    type === "pdf"
      ? imagePDF(
          new Uint8Array(await blob.arrayBuffer()),
          snapshot.width,
          snapshot.height,
        )
      : blob;
  const url = URL.createObjectURL(file),
    a = document.createElement("a");
  a.href = url;
  a.download = name + "." + type;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $("brief-status").textContent =
    "已导出当前概览 " + type.toUpperCase() + "，请查看浏览器下载目录。";
}
export function openBrief(ctx) {
  context = ctx;
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "brief-dialog";
    dialog.id = "brief-dialog";
    dialog.setAttribute("aria-label", "一页纸概览");
    document.body.append(dialog);
    dialog.addEventListener("close", () => {
      ++seq;
      worker?.postMessage({ type: "cancel" });
      if (dirty) {
        $("brief-generate").disabled = false;
        $("brief-status").textContent = "点击生成概览继续。";
      }
      document.getElementById("one-page-open")?.focus();
    });
  }
  const key = JSON.stringify([
    ctx.manifest.version,
    ctx.ids,
    ctx.start,
    ctx.end,
    ctx.plats,
  ]);
  if (lastKey === key && dialog.querySelector("#brief-generate")) {
    dialog.showModal();
    return;
  }
  lastKey = key;
  const roots = [...new Set(ctx.categories.map((c) => c.path[0]))];
  dialog.innerHTML = `<header class="brief-head"><div><h2>一页纸概览</h2><small>判断市场 · 定位机会 · 验证切入点</small></div><button id="brief-close" aria-label="关闭一页纸概览">关闭</button></header><div class="brief-body"><div class="brief-controls">
 <div class="toolbar"><label>类目 <select id="brief-root">${pathOf(ctx.categories.filter((c) => ctx.ids.includes(c.id))).length ? '<option value="current">当前所选类目</option>' : '<option value="">请选择一级类目</option>'}${roots.map((r) => `<option>${esc(r)}</option>`).join("")}</select></label><label>二级 <select id="brief-second"></select></label><label>三级 <select id="brief-leaf"></select></label></div>
 <div class="toolbar"><label>时段 <select id="brief-period"><option value="custom">自定义</option><option value="mat">近12个月</option><option value="year">年累计</option>${Array.from(
   {
     length:
       Math.floor(ctx.manifest.last / 100) -
       Math.floor(ctx.manifest.first / 100) +
       1,
   },
   (_, i) => Math.floor(ctx.manifest.first / 100) + i,
 )
   .map((y) => `<option value="year:${y}">${y}年</option>`)
   .join(
     "",
   )}</select></label><label>起始 <input id="brief-start" type="month" min="${ym(ctx.manifest.first)}" max="${ym(ctx.manifest.last)}" value="${ym(ctx.start)}"></label><label>截止 <input id="brief-end" type="month" min="${ym(ctx.manifest.first)}" max="${ym(ctx.manifest.last)}" value="${ym(ctx.end)}"></label>${PLATFORMS.map((p, i) => `<label><input type="checkbox" data-brief-platform value="${i}" ${ctx.plats.includes(i) ? "checked" : ""}>${p}</label>`).join("")}</div>
 <fieldset><legend>价格带（可多选，不选即全部）</legend>${PRICE.map((p, i) => `<label><input type="checkbox" data-brief-band value="${i}">${p}元</label>`).join("")}</fieldset>
 <div class="brief-actions"><button id="brief-generate" class="primary">生成概览</button><button id="brief-pdf" disabled>导出PDF</button><button id="brief-png" disabled>导出图片</button><span id="brief-status" role="status">选择范围后生成；筛选仅影响本报告。</span></div>
 <details><summary>机会判定规则与口径</summary><p>${reportRules} 全报告使用商品表同源汇总；CR5未知品牌计入分母。金额覆盖不足或短窗口不推荐机会。PDF与图片使用同一报告快照；PDF为图片版。</p></details></div>
 <div id="brief-preview"><p class="note">生成后在此预览完整一页纸。顶部先给判断，价格带下方展开机会类目。</p></div><details class="brief-accessible"><summary>阅读文字小结</summary><p id="brief-text"></p></details></div>`;
  selectors();
  $("brief-close").onclick = () => dialog.close();
  $("brief-root").onchange = () => {
    selectors(true);
    invalidate();
  };
  $("brief-second").onchange = () => {
    leaves();
    invalidate();
  };
  $("brief-leaf").onchange = invalidate;
  $("brief-period").onchange = () => {
    dates();
    invalidate();
  };
  $("brief-end").onchange = () => {
    dates();
    invalidate();
  };
  $("brief-start").onchange = invalidate;
  dialog
    .querySelectorAll('input[type="checkbox"]')
    .forEach((el) => (el.onchange = invalidate));
  $("brief-generate").onclick = generate;
  $("brief-pdf").onclick = () => download("pdf");
  $("brief-png").onclick = () => download("png");
  dialog.showModal();
}
