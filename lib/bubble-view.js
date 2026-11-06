import { seaColor, CR5_RANGES, inCr5Range } from "./distribution.js?v=2.6.1";

export function mountDistribution(host, ctx) {
  const { esc, money, pct } = ctx;
  let path = [],
    band = null,
    root = "",
    second = "",
    level = 1,
    range = "all",
    sea = "all",
    serial = 0,
    paintSerial = 0,
    data = [];
  const cache = new Map();
  const nameBand = (b) =>
    b < 0
      ? "价格缺失 / 非正"
      : [
          "0–50",
          "50–100",
          "100–200",
          "200–400",
          "400–600",
          "600–1000",
          "1000–2000",
          "2000–5000",
          "5000+",
        ][b] + "元";
  const options = (items, value) =>
    '<option value="">全部</option>' +
    items
      .map(
        (x) =>
          `<option ${x === value ? "selected" : ""} value="${esc(x)}">${esc(x)}</option>`,
      )
      .join("");
  const scope = () =>
    ctx.categories.filter(
      (c) =>
        (!root || c.path[0] === root) &&
        (!second || c.path[1] === second) &&
        path.every((p, i) => c.path[i] === p),
    );
  function controls() {
    return `<div class="toolbar bubble-controls"><label>一级类目 <select id="bubble-root">${options([...new Set(ctx.categories.map((c) => c.path[0]))], root)}</select></label><label>二级类目 <select id="bubble-second">${options([...new Set(ctx.categories.filter((c) => !root || c.path[0] === root).map((c) => c.path[1]))], second)}</select></label><label>展示层级 <select id="bubble-level">${[1, 2, 3].map((n) => `<option value="${n}" ${(path.length ? Math.min(3, path.length + 1) : level) === n ? "selected" : ""}>${n}级类目</option>`).join("")}</select></label><label>CR5区间 <select id="bubble-range" title="10%归第一档；30%归第三档；50%归第四档">${CR5_RANGES.map(([v, n]) => `<option value="${v}" ${range === v ? "selected" : ""}>${n}</option>`).join("")}</select></label>${[
      ["all", "全部"],
      ["blue", "蓝海 <30%"],
      ["red", "红海 ≥30%"],
    ]
      .map(
        ([v, n]) =>
          `<button data-sea="${v}" aria-pressed="${sea === v}">${n}</button>`,
      )
      .join(
        "",
      )}<button id="bubble-reset">重置图表</button></div><div class="bubble-breadcrumb"><button data-back="0">分布总览</button>${path.map((p, i) => ` / <button data-back="${i + 1}">${esc(p)}</button>`).join("")}${band !== null ? " / " + nameBand(band) + " / TOP5品牌" : ""}</div><p class="note">${String(ctx.end - 0).slice(0, 4)}-${String(ctx.end).slice(4)} 截止的近12个月 · 横轴与气泡面积均表示GMV规模 · 纵轴为同比。蓝海CR5越低越蓝，红海CR5越高越红；灰色为CR5缺失或品牌。${path.length >= 3 ? "价格带及品牌使用商品表，同比为已入库金额同比。" : "类目同比使用两期共同记录；CR5按品牌表汇总后重排，不能平均子类目CR5。"}<br>此处筛选只影响本图；点击气泡或下方名称下钻，面包屑返回；拥挤标签自动省略，可悬浮或查看明细。${band !== null ? "品牌层不应用CR5筛选。" : ""}</p><div class="sea-legend" aria-label="CR5连续渐变色图例"><span>蓝海：越小越蓝</span><i style="background:linear-gradient(90deg,${seaColor(0)},${seaColor(0.3 - Number.EPSILON)})"></i><small>0% → 30%以下</small><span>红海：越大越红</span><i style="background:linear-gradient(90deg,${seaColor(0.3)},${seaColor(1)})"></i><small>30% → 100%</small></div>`;
  }
  function bindControls() {
    host
      .querySelectorAll("#bubble-range,[data-sea]")
      .forEach((el) => (el.disabled = band !== null));

    host.querySelector("#bubble-root").onchange = (e) => {
      root = e.target.value;
      second = "";
      path = [];
      band = null;
      level = root ? 2 : 1;
      refresh();
    };
    host.querySelector("#bubble-second").onchange = (e) => {
      second = e.target.value;
      path = [];
      band = null;
      level = second ? 3 : root ? 2 : 1;
      refresh();
    };
    host.querySelector("#bubble-level").onchange = (e) => {
      level = +e.target.value;
      path = [];
      band = null;
      refresh();
    };
    host.querySelector("#bubble-range").onchange = (e) => {
      range = e.target.value;
      sea = "all";
      paint();
    };
    host.querySelectorAll("[data-sea]").forEach(
      (el) =>
        (el.onclick = () => {
          sea = el.dataset.sea;
          range = "all";
          paint();
        }),
    );
    host.querySelectorAll("[data-back]").forEach(
      (el) =>
        (el.onclick = () => {
          path = path.slice(0, +el.dataset.back);
          band = null;
          refresh();
        }),
    );
    host.querySelector("#bubble-reset").onclick = () => {
      path = [];
      band = null;
      root = "";
      second = "";
      level = 1;
      range = "all";
      sea = "all";
      refresh();
    };
  }
  function drill(i) {
    const r = data[i];
    if (band !== null) return;
    if (path.length >= 3) band = r.key;
    else path = r.path;
    refresh();
  }
  function paint() {
    if (!ctx.isCurrent() || !host.isConnected) return;
    const paintTicket = ++paintSerial,
      paintStarted = performance.now();
    const rows = data
      .map((r, i) => ({ ...r, i }))
      .filter(
        (r) =>
          band !== null ||
          ((sea === "all" ||
            (Number.isFinite(r.cr5) &&
              (sea === "blue" ? r.cr5 < 0.3 : r.cr5 >= 0.3))) &&
            inCr5Range(r.cr5, range)),
      );
    const points = rows.filter((r) => r.g > 0 && Number.isFinite(r.y));
    const xmax = Math.max(1, ...points.map((r) => r.g)) * 1.08;
    const ymin = Math.min(0, ...points.map((r) => r.y)),
      ymax = Math.max(0.1, ...points.map((r) => r.y));
    const pad = (ymax - ymin) * 0.15,
      lo = ymin - pad,
      hi = ymax + pad;
    const x = (g) => 95 + (g / xmax) * 820,
      y = (v) => 410 - ((v - lo) / (hi - lo)) * 340;
    const ticks = Array.from({ length: 5 }, (_, i) => i / 4);
    const labelBoxes = [],
      labels = new Map();
    for (const r of [...points].sort((a, b) => b.g - a.g).slice(0, 60)) {
      const name = r.path?.at(-1) || r.name,
        text = name.length > 13 ? name.slice(0, 12) + "…" : name;
      const width = Math.min(170, text.length * 12),
        cx = Math.max(95 + width / 2, Math.min(915 - width / 2, x(r.g)));
      const cy = y(r.y) - Math.sqrt(r.g / xmax) * 42 - 7;
      const box = {
        left: cx - width / 2 - 4,
        right: cx + width / 2 + 4,
        top: cy - 13,
        bottom: cy + 4,
      };
      if (
        cy < 40 ||
        labelBoxes.some(
          (b) =>
            box.left < b.right &&
            box.right > b.left &&
            box.top < b.bottom &&
            box.bottom > b.top,
        )
      )
        continue;
      labelBoxes.push(box);
      labels.set(
        r.i,
        `<text x="${cx}" y="${cy}" text-anchor="middle">${esc(text)}</text>`,
      );
    }

    const svg = `<svg viewBox="0 0 1000 480" role="img" aria-label="GMV与同比气泡分布图">${ticks.map((v) => `<line x1="95" x2="915" y1="${y(lo + v * (hi - lo))}" y2="${y(lo + v * (hi - lo))}" stroke="var(--line,#ddd)"/><text x="85" y="${y(lo + v * (hi - lo)) + 4}" text-anchor="end">${pct(lo + v * (hi - lo))}</text><text x="${x(v * xmax)}" y="435" text-anchor="middle">${money(v * xmax)}</text>`).join("")}<line x1="95" x2="915" y1="${y(0)}" y2="${y(0)}" stroke="#8993a1" stroke-dasharray="4 4"/><text x="100" y="30">同比增速</text><text x="540" y="470" text-anchor="middle">近12个月 GMV（退后，元）</text><g class="bubble-points"></g></svg>`;
    const pointMarkup = [...points]
      .sort((a, b) => b.g - a.g)
      .map(
        (r) =>
          `<g ${band === null ? `role="button" tabindex="0" data-point="${r.i}"` : ""} aria-label="${esc(r.name)}，GMV ${money(r.g)}，同比 ${pct(r.y)}，CR5 ${pct(r.cr5)}"><title>${esc(r.name)}\nGMV ${money(r.g)} · 同比 ${pct(r.y)} · CR5 ${pct(r.cr5)}</title><circle cx="${x(r.g)}" cy="${y(r.y)}" r="${Math.sqrt(r.g / xmax) * 42}" fill="${seaColor(band !== null ? null : r.cr5)}" fill-opacity="1" stroke="var(--surface,#fff)" stroke-width="1.5"/>${labels.get(r.i) || ""}</g>`,
      );
    host.innerHTML =
      controls() +
      `<p id="bubble-status" role="status" class="note">${rows.length} 个结果 · ${points.length} 个可绘制；同比缺失或GMV非正的记录保留在明细。</p><div class="bubble-chart">${points.length ? svg : '<p class="empty">当前范围没有可绘制的气泡，请调整筛选或查看明细。</p>'}</div><details class="bubble-details"><summary>查看明细（${rows.length}）与下钻入口</summary><div class="bubble-detail-body"></div></details>`;
    const pointHost = host.querySelector(".bubble-points");
    const appendPoints = (offset) => {
      if (
        paintTicket !== paintSerial ||
        !ctx.isCurrent() ||
        !pointHost?.isConnected
      )
        return;
      const started = performance.now();
      pointHost.insertAdjacentHTML(
        "beforeend",
        pointMarkup.slice(offset, offset + 100).join(""),
      );
      host.dataset.maxPaintBatchMs = String(
        Math.max(
          +(host.dataset.maxPaintBatchMs || 0),
          performance.now() - started,
        ),
      );
      if (offset + 100 < pointMarkup.length)
        (globalThis.requestAnimationFrame || ((f) => setTimeout(f, 0)))(() =>
          appendPoints(offset + 100),
        );
      else host.dataset.rendering = "false";
    };
    if (pointHost) {
      host.dataset.rendering = "true";
      if (pointMarkup.length <= 200) {
        pointHost.innerHTML = pointMarkup.join("");
        host.dataset.rendering = "false";
      } else appendPoints(0);
    }
    host.dataset.paintMs = (performance.now() - paintStarted).toFixed(1);
    bindControls();
    let detailPage = 0;
    const details = host.querySelector(".bubble-details");
    const drawDetails = () => {
      host.querySelector(".bubble-detail-body").innerHTML =
        `<div class="table-scroll"><table><thead><tr><th>名称</th><th>近12个月GMV</th><th>同比</th><th>CR5</th></tr></thead><tbody>${rows
          .slice(detailPage * 50, (detailPage + 1) * 50)
          .map(
            (r) =>
              `<tr><td>${band === null ? `<button data-point="${r.i}">${esc(r.name)}</button>` : esc(r.name)}${r.coverage ? `<br><small>${esc(r.coverage)}</small>` : ""}</td><td>${money(r.g)}</td><td>${pct(r.y)}</td><td>${band !== null ? "不适用" : pct(r.cr5)}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div><button data-detail-page="-1" ${detailPage === 0 ? "disabled" : ""}>上一页</button> ${detailPage + 1}/${Math.max(1, Math.ceil(rows.length / 50))} 页 · 每页50条 <button data-detail-page="1" ${(detailPage + 1) * 50 >= rows.length ? "disabled" : ""}>下一页</button>`;
    };
    details.ontoggle = () => {
      if (details.open) drawDetails();
    };
    host.onclick = (e) => {
      const point = e.target.closest("[data-point]");
      if (point) {
        drill(+point.dataset.point);
        return;
      }
      const page = e.target.closest("[data-detail-page]");
      if (page) {
        detailPage += +page.dataset.detailPage;
        drawDetails();
      }
    };
    host.onkeydown = (e) => {
      const point = e.target.closest("g[data-point]");
      if (point && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        drill(+point.dataset.point);
      }
    };
  }
  async function refresh() {
    const ticket = ++serial;
    ++paintSerial;
    data = [];
    host.innerHTML =
      controls() + '<p id="bubble-status" role="status">正在加载分布数据…</p>';
    bindControls();
    try {
      const cats = scope();
      if (!cats.length) {
        data = [];
        paint();
        return;
      }
      const price = path.length >= 3,
        groups = [];
      if (price) groups.push({ ids: cats.map((c) => c.id) });
      else {
        const depth = path.length ? path.length + 1 : level;
        const groupMap = new Map();
        for (const c of cats) {
          const p = c.path.slice(0, depth),
            key = JSON.stringify(p);
          let g = groupMap.get(key);
          if (!g) {
            g = { key, path: p, ids: [] };
            groups.push(g);
            groupMap.set(key, g);
          }
          g.ids.push(c.id);
        }
      }
      const started = performance.now();
      const key = JSON.stringify([price, groups]);
      let result = cache.get(key);
      if (!result) {
        result = await Promise.all([
          ctx.request(groups, price),
          price
            ? Promise.resolve(null)
            : ctx.aggregateGroups
              ? ctx.aggregateGroups(groups)
              : Promise.resolve(groups.map((g) => ctx.aggregate(g.ids))),
        ]);
        cache.set(key, result);
      }
      if (ticket !== serial || !ctx.isCurrent()) return;
      const [summary, stats] = result;
      if (price) {
        data =
          band === null
            ? summary.map((r) => ({ ...r, name: nameBand(r.key) }))
            : summary.find((r) => r.key === band)?.top || [];
      } else {
        const byKey = new Map(summary.map((r) => [r.key, r]));
        data = groups.map((g, i) => ({
          ...stats[i],
          cr5: byKey.get(i)?.cr5 ?? null,
          name: g.path.join(" / "),
          path: g.path,
        }));
      }
      paint();
      host.dataset.loadMs = (performance.now() - started).toFixed(1);
    } catch (e) {
      if (ticket === serial && ctx.isCurrent()) {
        host.innerHTML =
          controls() +
          `<p id="bubble-status" role="alert">气泡数据加载失败：${esc(e.message)}</p><button id="bubble-retry">重试</button>`;
        bindControls();
        host.querySelector("#bubble-retry").onclick = refresh;
      }
    }
  }
  refresh();
}
