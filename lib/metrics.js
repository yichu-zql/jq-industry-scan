export const PLATFORMS = ["天猫", "京东", "抖音"];
export const GROWTH = [
  "持续下滑",
  "持平或波动增长/回落",
  "持续中低速增长",
  "持续高速增长",
];
export const BANDS = [
  "1–5亿",
  "5–10亿",
  "10–30亿",
  "30–50亿",
  "50–100亿",
  "100亿+",
];
export const PRICE = [
  "0–50",
  "50–100",
  "100–200",
  "200–400",
  "400–600",
  "600–1000",
  "1000–2000",
  "2000–5000",
  "5000+",
];
export function shift(ym, n) {
  const d = new Date(Date.UTC(Math.floor(ym / 100), (ym % 100) - 1 + n, 1));
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
}
export function months(a, b) {
  const out = [];
  for (let m = a; m <= b; m = shift(m, 1)) {
    out.push(m);
    if (out.length > 600) break;
  }
  return out;
}
export const ratio = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
export const yoy = (a, b) => {
  const r = ratio(a, b);
  return r == null ? null : r - 1;
};
export function classify(years) {
  if (years.length !== 4 || years.some((v) => !Number.isFinite(v) || v <= 0))
    return { group: null, cagr: null, ys: [], reason: "历史不足或基期非正" };
  const ys = years.slice(1).map((v, i) => v / years[i] - 1);
  const cagr = Math.pow(years[3] / years[0], 1 / 3) - 1;
  const all = years.slice(1).every((v, i) => v > years[i]),
    spike = years.slice(1).some((v, i) => v > years[i] * 1.5);
  return {
    ys,
    cagr,
    group: years.slice(1).every((v, i) => v < years[i])
      ? 0
      : all
        ? cagr >= 0.2 - Number.EPSILON * 4
          ? 3
          : 2
        : 1,
    eligibleHistory: all || spike,
    reason: all ? "连续三年正增长" : spike ? "历史同比＞50%" : "未满足增长条件",
  };
}
export const scale = (g) =>
  !Number.isFinite(g) || g < 1e8
    ? null
    : [5e8, 1e9, 3e9, 5e9, 1e10, Infinity].findIndex((x) => g < x);
export function lastFullYear(end) {
  return Math.floor(end / 100) - (end % 100 === 12 ? 0 : 1);
}
export function annualRange(end) {
  const y = lastFullYear(end);
  return [y - 3, y - 2, y - 1, y];
}
export function indexIndustry(rows) {
  const index = new Map();
  for (const [id, m, p, g, q] of rows) {
    if (!index.has(id)) index.set(id, new Map());
    index.get(id).set(m + "|" + p, { g, q });
  }
  return index;
}
export function aggregate(index, ids, plats, start, end) {
  let g = 0,
    q = 0,
    present = 0,
    expected = 0,
    validG = true,
    validQ = true;
  const byPlat = plats.map((p) => ({ p, g: 0, q: 0, present: 0, expected: 0 }));
  const ms = months(start, end);
  for (const id of ids) {
    const im = index.get(id);
    for (const m of ms)
      for (const entry of byPlat) {
        expected++;
        entry.expected++;
        const r = im?.get(m + "|" + entry.p);
        if (!r) {
          continue;
        }
        present++;
        entry.present++;
        if (Number.isFinite(r.g)) {
          g += r.g;
          entry.g += r.g;
        } else validG = false;
        if (Number.isFinite(r.q)) {
          q += r.q;
          entry.q += r.q;
        } else validQ = false;
      }
  }
  return {
    g: present ? g : null,
    q: present ? q : null,
    amountValid: present > 0 && validG,
    qtyValid: present > 0 && validQ,
    complete: expected > 0 && validG && present === expected,
    qtyComplete: expected > 0 && validQ && present === expected,
    present,
    expected,
    byPlat,
  };
}
// Compare only exact category/month/platform pairs observed in both periods.
// Excluded records remain missing and never become artificial zero sales.
export function pairedAggregate(index, ids, plats, start, end) {
  let g = 0,
    g0 = 0,
    q = 0,
    q0 = 0,
    pairs = 0,
    qtyValid = true;
  const calendar = months(start, end).map((month) => [
    month,
    shift(month, -12),
  ]);
  for (const id of ids) {
    const im = index.get(id);
    for (const [month, priorMonth] of calendar)
      for (const p of plats) {
        const a = im?.get(month + "|" + p),
          b = im?.get(priorMonth + "|" + p);
        if (!Number.isFinite(a?.g) || !Number.isFinite(b?.g)) continue;
        g += a.g;
        g0 += b.g;
        pairs++;
        if (Number.isFinite(a.q) && Number.isFinite(b.q)) {
          q += a.q;
          q0 += b.q;
        } else qtyValid = false;
      }
  }
  return {
    cur: { g: pairs ? g : null, q: pairs && qtyValid ? q : null },
    prev: { g: pairs ? g0 : null, q: pairs && qtyValid ? q0 : null },
    pairs,
    qtyValid: pairs > 0 && qtyValid,
  };
}
export function categoryMetrics(index, id, plats, start, end) {
  const cur = aggregate(index, [id], plats, start, end),
    prev = aggregate(index, [id], plats, shift(start, -12), shift(end, -12)),
    annual = aggregate(index, [id], plats, shift(end, -11), end),
    annualPrev = aggregate(
      index,
      [id],
      plats,
      shift(end, -23),
      shift(end, -12),
    );
  const years = annualRange(end),
    totals = years.map((y) =>
      aggregate(index, [id], plats, y * 100 + 1, y * 100 + 12),
    );
  const growth = classify(totals.map((r) => (r.complete ? r.g : null)));
  const band = annual.complete ? scale(annual.g) : null;
  return {
    id,
    cur,
    prev,
    annual,
    annualPrev,
    years,
    growth,
    band,
    eligible: band !== null && growth.eligibleHistory === true,
  };
}
export function isKnown(name) {
  return (
    !!name &&
    !/^(其他(?:\s*Other)?|Other|未识别品牌|无品牌|未知|无)$/i.test(name.trim())
  );
}
export function sumRows(
  rows,
  plats,
  start,
  end,
  gidx,
  qidx,
  predicate = () => true,
) {
  let g = 0,
    q = 0,
    n = 0;
  for (const r of rows)
    if (r[0] >= start && r[0] <= end && plats.includes(r[1]) && predicate(r)) {
      if (Number.isFinite(r[gidx])) g += r[gidx];
      if (Number.isFinite(r[qidx])) q += r[qidx];
      n++;
    }
  return { g: n ? g : null, q: n ? q : null, n };
}
export function brandRank(rows, plats, start, end) {
  const map = new Map();
  for (const r of rows) {
    if (r[0] < start || r[0] > end || !plats.includes(r[1])) continue;
    const k = r[2] || "未识别品牌",
      a = map.get(k) || { name: k, g: 0, q: 0 };
    a.g += r[3] ?? 0;
    a.q += r[4] ?? 0;
    map.set(k, a);
  }
  return [...map.values()].sort((a, b) => b.g - a.g);
}
export function concentration(ranks, total, complete = true) {
  const sum = ranks.reduce((s, r) => s + r.g, 0);
  const gap = yoy(sum, total);
  if (!complete || total <= 0 || !Number.isFinite(gap) || Math.abs(gap) > 0.01)
    return {
      cr5: null,
      top: ranks
        .filter((r) => isKnown(r.name))
        .slice(0, 3)
        .map((r) => ({ ...r, share: null })),
      gap,
      coverage: ratio(sum, total),
      reason: "品牌汇总与行业口径未通过1%对账",
    };
  const known = ranks.filter((r) => isKnown(r.name));
  return {
    cr5: known.slice(0, 5).reduce((s, r) => s + r.g, 0) / total,
    top: known.slice(0, 3).map((r) => ({ ...r, share: r.g / total })),
    gap,
    coverage: sum / total,
  };
}
export function csv(rows) {
  const quote = (v) => {
    const raw = String(v ?? "");
    return (
      '"' +
      (typeof v === "number" ? raw : raw.replace(/^[=+@\-]/, "'$&")).replaceAll(
        '"',
        '""',
      ) +
      '"'
    );
  };
  return "\ufeff" + rows.map((r) => r.map(quote).join(",")).join("\r\n");
}
