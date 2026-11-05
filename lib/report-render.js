import { PRICE, PLATFORMS } from "./metrics.js";
export const compactNumber = (v) =>
  !Number.isFinite(v)
    ? "—"
    : Math.abs(v) >= 1e8
      ? (v / 1e8).toFixed(1) + "亿"
      : Math.abs(v) >= 1e4
        ? (v / 1e4).toFixed(1) + "万"
        : v.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export const percent = (v) =>
  Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—";
const signed = (v) =>
  Number.isFinite(v) ? (v > 0 ? "+" : "") + percent(v) : "—";
const bandName = (b) => (b < 0 ? "未定价" : PRICE[b] + "元");
export function reportNarrative(r) {
  const lead = r.candidates[0],
    t = r.total;
  const headline = lead
    ? `发现 ${r.candidateCount} 个机会候选，优先研究「${lead.path[2]}」`
    : t.g > 0
      ? "暂未发现同时满足规模与增长条件的机会类目"
      : "当前范围暂无可分析记录";
  const market =
    t.g > 0
      ? `市场判断：所选商品GMV ${compactNumber(t.g)}，可比同比 ${signed(t.y)}。${t.y === null ? "当前证据不足以判断增长。" : t.coverage < 0.8 ? "可比样本有限，暂不外推整体增长。" : t.y > 0 ? "成交金额扩张，应区分市场普涨与结构性份额提升。" : "总量承压，优先寻找细分替代机会，不宜仅凭低集中度进入。"}`
      : "请调整类目、价格带或时段后再生成。";
  const opportunity = lead
    ? `机会落点：${lead.path[2]}同比 ${signed(lead.y)}，领先所选市场 ${((lead.y - t.y) * 100).toFixed(1)}pp；${lead.price ? bandName(lead.price.band) + "为" + lead.price.reason : "先核查具体成交价位"}。优先验证该组合的需求和产品差异。`
    : "机会判断：本次没有足够证据推荐具体切入类目，可放宽价格范围或延长观察窗口；不将增长榜直接等同进入机会。";
  const cr = lead?.evidence?.cr5 ?? r.brands?.cr5;
  const risk = `进入条件：${Number.isFinite(cr) ? "目标" + (lead ? "价位" : "市场") + "CR5 " + percent(cr) + "，" + (cr >= 0.5 ? "头部优势明显，需要验证产品差异和获客成本。" : cr >= 0.3 ? "已有成熟竞争，需要验证细分人群与卖点。" : "竞争较分散，仍需验证品牌稳定性和履约能力。") : "竞争证据有限，先核查主要品牌。"}盈利、评价与渠道成本需另行验证。`;
  return { headline, lines: [market, opportunity, risk] };
}
export function drawReport(canvas, r, meta) {
  const W = 1440,
    H = 2036;
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");
  const ink = "#222b39",
    muted = "#607087",
    wine = "#922b5b",
    blue = "#2766a8";
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);
  const text = (s, x, y, size = 21, color = ink, bold = false) => {
    c.fillStyle = color;
    c.font = `${bold ? 600 : 400} ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    c.fillText(String(s), x, y);
  };
  function wrap(s, x, y, width, size = 22, line = 34, max = 3, color = ink) {
    c.font = `400 ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    const lines = [];
    let cur = "";
    for (const ch of String(s)) {
      if (c.measureText(cur + ch).width > width && cur) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    lines
      .slice(0, max)
      .forEach((v, i) =>
        text(
          i === max - 1 && lines.length > max ? v.slice(0, -1) + "…" : v,
          x,
          y + i * line,
          size,
          color,
        ),
      );
    return Math.min(lines.length, max) * line;
  }
  const box = (x, y, w, h) => {
    c.fillStyle = "#fafbfc";
    c.fillRect(x, y, w, h);
    c.strokeStyle = "#dfe4eb";
    c.lineWidth = 1;
    c.strokeRect(x, y, w, h);
  };
  const heading = (s, x, y) => text(s, x, y, 26, ink, true);
  wrap(meta.title + " · 一页纸概览", 50, 57, 1340, 32, 38, 1);
  text(
    `${meta.period}  |  ${meta.bands}  |  ${meta.platforms}`,
    50,
    96,
    19,
    muted,
  );
  c.fillStyle = "#f6edf2";
  c.fillRect(50, 122, 1340, 276);
  c.fillStyle = wine;
  c.fillRect(50, 122, 7, 276);
  const narrative = reportNarrative(r);
  wrap(narrative.headline, 77, 165, 1280, 30, 40, 1, wine);
  narrative.lines.forEach((line, i) =>
    wrap(line, 77, 211 + i * 61, 1275, 22, 29, 2),
  );
  const stats = [
    ["GMV（退后）", compactNumber(r.total.g)],
    ["可比同比", signed(r.total.y)],
    [
      "件均价",
      r.total.q > 0 ? "¥" + compactNumber(r.total.g / r.total.q) : "—",
    ],
    ["品牌CR5", percent(r.brands?.cr5)],
  ];
  stats.forEach(([name, v], i) => {
    text(name, 70 + i * 336, 444, 20, muted);
    text(v, 70 + i * 336, 489, 36, ink, true);
  });
  box(50, 522, 650, 306);
  box(720, 522, 670, 306);
  heading("规模与增长", 72, 562);
  heading(r.filter.path.length >= 3 ? "平台结构" : "细分类目结构", 742, 562);
  const trend = r.trend,
    good = trend.filter((v) => Number.isFinite(v.g)),
    maxG = Math.max(...good.map((v) => v.g), 1);
  const stride = Math.max(1, Math.ceil(trend.length / 36));
  // All months remain in the calculation; aggregate chart columns only when the period is long.
  const points = [];
  for (let i = 0; i < trend.length; i += stride) {
    const slice = trend.slice(i, i + stride);
    points.push({
      month: slice[0].month,
      g: slice.some((v) => v.g !== null)
        ? slice.reduce((s, v) => s + (v.g || 0), 0)
        : null,
    });
  }
  const maximum = Math.max(...points.map((v) => v.g || 0), 1),
    bw = 590 / Math.max(points.length, 1);
  points.forEach((v, i) => {
    if (v.g === null) return;
    const h = Math.max(0, (v.g / maximum) * 137);
    c.fillStyle = wine;
    c.fillRect(78 + i * bw, 744 - h, Math.max(2, bw - 4), h);
  });
  text("0", 74, 767, 15, muted);
  text(compactNumber(maximum), 74, 593, 17, muted);
  text(String(trend[0]?.month || ""), 100, 767, 16, muted);
  text(String(trend.at(-1)?.month || ""), 582, 767, 16, muted);
  text(
    stride > 1 ? `每柱汇总 ${stride} 个月` : "逐月GMV；空白月份不补零",
    75,
    803,
    18,
    muted,
  );
  const structure =
    r.filter.path.length >= 3
      ? r.platforms.map((v) => ({ ...v, name: PLATFORMS[v.p] }))
      : r.structure;
  structure.slice(0, 5).forEach((v, i) => {
    const y = 601 + i * 40;
    text(v.name, 744, y, 19);
    c.fillStyle = "#d3dfef";
    c.fillRect(
      963,
      y - 19,
      Math.max(0, (v.g / Math.max(...structure.map((v) => v.g || 0), 1)) * 200),
      23,
    );
    text(compactNumber(v.g), 1174, y, 19);
    text(signed(v.y), 1290, y, 17, v.y > 0 ? "#147a55" : muted);
  });
  box(50, 850, 650, 372);
  box(720, 850, 670, 372);
  heading(r.prices.length === 1 ? "所选价位的市场位置" : "价格带分布", 72, 890);
  heading("品牌竞争 · TOP5", 742, 890);
  const denominator = r.total.g || 1;
  if (r.prices.length === 1) {
    const v = r.prices[0];
    text(bandName(v.band), 76, 946, 29, ink, true);
    text(
      "占该类目全价位商品GMV " + percent(r.selectionShare),
      76,
      996,
      23,
      wine,
    );
    text("可比同比 " + signed(v.y), 76, 1042, 23);
    wrap(
      "以全价位市场为参照，判断该价位的成交权重。",
      76,
      1102,
      570,
      21,
      31,
      2,
      muted,
    );
  } else
    r.prices.slice(0, 10).forEach((v, i) => {
      const y = 932 + i * 25;
      text(bandName(v.band), 75, y, 18);
      c.fillStyle = "#b7cce6";
      c.fillRect(220, y - 16, Math.max(0, (v.g / denominator) * 285), 17);
      text(percent(v.g / denominator), 521, y, 17);
      text(signed(v.y), 606, y, 16, muted);
    });
  (r.brands?.top || []).forEach((v, i) => {
    const y = 947 + i * 46;
    wrap(`${i + 1}. ${v.name}`, 744, y, 350, 21, 25, 1);
    text(percent(v.share), 1120, y, 21, wine, true);
    text(compactNumber(v.g), 1245, y, 20);
  });
  const priceLead = [...r.prices].sort((a, b) => b.g - a.g)[0];
  text(
    priceLead ? "主销价位：" + bandName(priceLead.band) : "当前无价位记录",
    75,
    1200,
    18,
    muted,
  );
  text(
    "TOP5占比 " + percent(r.brands?.cr5) + "；未识别品牌计入分母",
    744,
    1200,
    18,
    muted,
  );
  heading("机会类目 · 从增长证据到切入位置", 50, 1270);
  text(
    "按可比增量排序，最多展示3项；为研究候选，不代表盈利结论",
    50,
    1304,
    19,
    muted,
  );
  if (!r.candidates.length) {
    box(50, 1330, 1340, 180);
    wrap(
      "本次筛选暂未发现同时满足规模、可比性和相对增长门槛的机会类目。可调整观察窗口或价格范围，继续验证结构性机会。",
      77,
      1380,
      1280,
      25,
      40,
      3,
    );
  }
  r.candidates.forEach((v, i) => {
    const y = 1330 + i * 184;
    box(50, y, 1340, 168);
    text(`${i + 1}  ${v.path[2]}`, 73, y + 39, 26, wine, true);
    text(v.path.slice(0, 2).join(" / "), 750, y + 38, 19, muted);
    text(
      `GMV ${compactNumber(v.g)}  ·  同比 ${signed(v.y)}  ·  可比增量 ${compactNumber(v.delta)}`,
      75,
      y + 78,
      21,
    );
    const p = v.price;
    text(
      p
        ? `${p.reason}：${bandName(p.band)}  ·  价位GMV ${compactNumber(p.g)}  ·  CR5 ${percent(v.evidence?.cr5)}`
        : "先进一步核查成交价位",
      75,
      y + 114,
      21,
    );
    wrap(
      "品牌参照：" +
        (v.evidence?.top
          .slice(0, 3)
          .map((b) => b.name + " " + percent(b.share))
          .join(" / ") || "暂无可展示品牌"),
      75,
      y + 147,
      1270,
      19,
      25,
      1,
      muted,
    );
  });
  c.strokeStyle = "#dfe4eb";
  c.beginPath();
  c.moveTo(50, 1905);
  c.lineTo(1390, 1905);
  c.stroke();
  wrap(
    `口径：久谦已入库商品数据｜GMV退后｜同比按共同类目-月份-平台-价格带记录｜SKU未接入，仅列品牌参照。`,
    50,
    1938,
    1340,
    17,
    25,
    2,
    muted,
  );
  text(
    `数据截至 ${meta.last} · 版本 ${meta.version} · 生成 ${meta.created}`,
    50,
    1994,
    17,
    muted,
  );
  return narrative;
}
// A single raster page keeps Chinese glyphs, charts and layout identical in PNG and PDF.
export function imagePDF(jpeg, width, height) {
  const enc = new TextEncoder(),
    parts = [];
  let size = 0;
  const offsets = [0];
  const push = (b) => {
    const a = typeof b === "string" ? enc.encode(b) : b;
    parts.push(a);
    size += a.length;
  };
  push("%PDF-1.4\n");
  const obj = (id, s) => {
    offsets[id] = size;
    push(`${id} 0 obj\n${s}\nendobj\n`);
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );
  offsets[4] = size;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  push(jpeg);
  push("\nendstream\nendobj\n");
  const stream = "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";
  obj(
    5,
    `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}endstream`,
  );
  const start = size;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++)
    push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}
