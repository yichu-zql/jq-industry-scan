import { seaColor } from "./distribution.js";

export function mountDistribution(host, ctx) {
  const { esc, money, pct } = ctx;
  let path = [],
    band = null,
    root = "",
    second = "",
    level = 1,
    min = "",
    max = "",
    sea = "all",
    serial = 0,
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
    return `<div class="toolbar bubble-controls"><label>一级类目 <select id="bubble-root">${options([...new Set(ctx.categories.map((c) => c.path[0]))], root)}</select></label><label>二级类目 <select id="bubble-second">${options([...new Set(ctx.categories.filter((c) => !root || c.path[0] === root).map((c) => c.path[1]))], second)}</select></label><label>展示层级 <select id="bubble-level">${[1, 2, 3].map((n) => `<option value="${n}" ${(path.length ? Math.min(3, path.length + 1) : level) === n ? "selected" : ""}>${n}级类目</option>`).join("")}</select></label><label>CR5区间 <input id="bubble-min" aria-label="CR5下限百分比" type="number" min="0" max="100" placeholder="0" value="${min}">—<input id="bubble-max" aria-label="CR5上限百分比" type="number" min="0" max="100" placeholder="100" value="${max}">%</label><button id="bubble-apply">应用区间</button>${[
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
      )}<button id="bubble-reset">重置图表</button></div><div class="bubble-breadcrumb"><button data-back="0">分布总览</button>${path.map((p, i) => ` / <button data-back="${i + 1}">${esc(p)}</button>`).join("")}${band !== null ? " / " + nameBand(band) + " / TOP5品牌" : ""}</div><p class="note">${String(ctx.end - 0).slice(0, 4)}-${String(ctx.end).slice(4)} 截止的近12个月 · 横轴与气泡面积均表示GMV规模 · 纵轴为同比。蓝海CR5越低越蓝，红海CR5越高越红；灰色为CR5缺失或品牌。${path.length >= 3 ? "价格带及品牌使用商品表，同比为已入库金额同比。" : "类目同比使用两期共同记录；CR5按品牌表汇总后重排，不能平均子类目CR5。"}<br>此处筛选只影响本图；点击气泡或下方名称下钻，面包屑返回；拥挤标签自动省略，可悬浮或查看明细。${band !== null ? "品牌层不应用CR5筛选。" : ""}</p>`;
  }
  function bindControls() {
    host
      .querySelectorAll("#bubble-min,#bubble-max,#bubble-apply,[data-sea]")
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
    host.querySelector("#bubble-apply").onclick = () => {
      const a = host.querySelector("#bubble-min").value,
        b = host.querySelector("#bubble-max").value;
      if (
        (a !== "" && (+a < 0 || +a > 100)) ||
        (b !== "" && (+b < 0 || +b > 100)) ||
        (a !== "" && b !== "" && +a > +b)
      ) {
        host.querySelector("#bubble-status").textContent =
          "CR5区间须在0–100%，下限不能大于上限。";
        return;
      }
      min = a;
      max = b;
      sea = "all";
      paint();
    };
    host.querySelectorAll("[data-sea]").forEach(
      (el) =>
        (el.onclick = () => {
          sea = el.dataset.sea;
          min = "";
          max = "";
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
      min = "";
      max = "";
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
    const rows = data
      .map((r, i) => ({ ...r, i }))
      .filter(
        (r) =>
          band !== null ||
          ((sea === "all" ||
            (Number.isFinite(r.cr5) &&
              (sea === "blue" ? r.cr5 < 0.3 : r.cr5 >= 0.3))) &&
            (min === "" || (Number.isFinite(r.cr5) && r.cr5 * 100 >= +min)) &&
            (max === "" || (Number.isFinite(r.cr5) && r.cr5 * 100 <= +max))),
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
    for (const r of [...points].sort((a, b) => b.g - a.g)) {
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

    const svg = `<svg viewBox="0 0 1000 480" role="img" aria-label="GMV与同比气泡分布图">${ticks.map((v) => `<line x1="95" x2="915" y1="${y(lo + v * (hi - lo))}" y2="${y(lo + v * (hi - lo))}" stroke="var(--line,#ddd)"/><text x="85" y="${y(lo + v * (hi - lo)) + 4}" text-anchor="end">${pct(lo + v * (hi - lo))}</text><text x="${x(v * xmax)}" y="435" text-anchor="middle">${money(v * xmax)}</text>`).join("")}<line x1="95" x2="915" y1="${y(0)}" y2="${y(0)}" stroke="#8993a1" stroke-dasharray="4 4"/><text x="100" y="30">同比增速</text><text x="540" y="470" text-anchor="middle">近12个月 GMV（退后，元）</text>${[
      ...points,
    ]
      .sort((a, b) => b.g - a.g)
      .map(
        (r) =>
          `<g ${band === null ? `role="button" tabindex="0" data-point="${r.i}"` : ""} aria-label="${esc(r.name)}，GMV ${money(r.g)}，同比 ${pct(r.y)}，CR5 ${pct(r.cr5)}"><title>${esc(r.name)}\nGMV ${money(r.g)} · 同比 ${pct(r.y)} · CR5 ${pct(r.cr5)}</title><circle cx="${x(r.g)}" cy="${y(r.y)}" r="${Math.sqrt(r.g / xmax) * 42}" fill="${seaColor(band !== null ? null : r.cr5)}" fill-opacity=".76" stroke="var(--surface,#fff)" stroke-width="1.5"/>${labels.get(r.i) || ""}</g>`,
      )
      .join("")}</svg>`;
    host.innerHTML =
      controls() +
      `<p id="bubble-status" role="status" class="note">${rows.length} 个结果 · ${points.length} 个可绘制；同比缺失或GMV非正的记录保留在明细。</p><div class="bubble-chart">${points.length ? svg : '<p class="empty">当前范围没有可绘制的气泡，请调整筛选或查看明细。</p>'}</div><details class="bubble-details"><summary>查看明细（${rows.length}）与下钻入口</summary><div class="table-scroll"><table><thead><tr><th>名称</th><th>近12个月GMV</th><th>同比</th><th>CR5</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${band === null ? `<button data-point="${r.i}">${esc(r.name)}</button>` : esc(r.name)}${r.coverage ? `<br><small>${esc(r.coverage)}</small>` : ""}</td><td>${money(r.g)}</td><td>${pct(r.y)}</td><td>${band !== null ? "不适用" : pct(r.cr5)}</td></tr>`).join("")}</tbody></table></div></details>`;
    bindControls();
    host.querySelectorAll("[data-point]").forEach((el) => {
      el.onclick = () => drill(+el.dataset.point);
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          drill(+el.dataset.point);
        }
      };
    });
  }
  async function refresh() {
    const ticket = ++serial;
    data = [];
    host.innerHTML =
      controls() +
      '<p id="bubble-status" role="status">正在汇总品牌数据与CR5…</p>';
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
        for (const c of cats) {
          const p = c.path.slice(0, depth),
            key = JSON.stringify(p);
          let g = groups.find((g) => g.key === key);
          if (!g) {
            g = { key, path: p, ids: [] };
            groups.push(g);
          }
          g.ids.push(c.id);
        }
      }
      const key = JSON.stringify([price, groups]);
      let result = cache.get(key);
      if (!result) {
        result = await ctx.request(groups, price);
        cache.set(key, result);
      }
      if (ticket !== serial || !ctx.isCurrent()) return;
      if (price) {
        data =
          band === null
            ? result.map((r) => ({ ...r, name: nameBand(r.key) }))
            : result.find((r) => r.key === band)?.top || [];
      } else
        data = groups.map((g, i) => ({
          ...ctx.aggregate(g.ids),
          cr5: result.find((r) => r.key === i)?.cr5 ?? null,
          name: g.path.join(" / "),
          path: g.path,
        }));
      paint();
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
