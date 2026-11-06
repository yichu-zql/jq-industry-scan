import { marketTrends, compareBrands } from "./trend-model.js?v=2.7.0";
import { priceSummary } from "./trend-prices.js?v=2.7.0";
const normalize = (s) =>
  String(s || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, "");
export function compileProductRule(rule) {
  if (!rule?.text) return () => true;
  const inc = rule.include.map(normalize),
    exc = rule.exclude.map(normalize);
  return (name) => {
    const s = normalize(name);
    return (
      !!s &&
      (inc.length === 0 ||
        (rule.mode === "any"
          ? inc.some((t) => s.includes(t))
          : inc.every((t) => s.includes(t)))) &&
      !exc.some((t) => s.includes(t))
    );
  };
}
export function productMatches(name, rule) {
  return compileProductRule(rule)(name);
}
const band = (a) =>
  !Number.isFinite(a) || a <= 0
    ? -1
    : a < 50
      ? 0
      : a < 100
        ? 1
        : a < 200
          ? 2
          : a < 400
            ? 3
            : a < 600
              ? 4
              : a < 1000
                ? 5
                : a < 2000
                  ? 6
                  : a < 5000
                    ? 7
                    : 8;
export function createProductAggregation(categories, f) {
  const matches = compileProductRule(f.rule);
  const market = new Map(),
    prices = new Map(),
    brands = new Map(),
    brandprices = new Map(),
    items = new Map(),
    oldItems = new Map();
  let matchedRecords = 0,
    scanned = 0,
    currentRecords = 0;
  const add = (map, key, g, q) => {
    if (!map.has(key)) map.set(key, { g: 0, q: 0, valid: true });
    const v = map.get(key);
    v.g += g;
    v.q += q ?? 0;
    v.valid &&= Number.isFinite(q);
  };
  const fresh = (map, key) => {
    if (!map.has(key)) map.set(key, { g: 0, q: 0, valid: true });
  };
  return {
    add(id, month, rows) {
      for (const r of rows) {
        const [platform, item, name, brand, asp, g, q] = r;
        const p =
          typeof platform === "number"
            ? platform
            : { tmall: 0, jd: 1, douyin: 2 }[platform];
        if (!f.plats.includes(p) || !Number.isFinite(g)) continue;
        scanned++;
        const mk = JSON.stringify([id, month, p]),
          pk = JSON.stringify([id, month, p, band(asp)]);
        // Available source records with no keyword hits are observed zero, not missing.
        fresh(market, mk);
        fresh(prices, pk);
        if (!matches(name)) continue;
        matchedRecords++;
        add(market, mk, g, q);
        add(prices, pk, g, q);
        const b =
          String(brand || "")
            .normalize("NFKC")
            .trim()
            .toLocaleLowerCase() || "未识别品牌";
        add(brands, JSON.stringify([month, p, b]), g, q);
        add(brandprices, JSON.stringify([month, p, b, band(asp)]), g, q);
        const current =
          month >= f.endYear * 100 + 1 && month <= f.endYear * 100 + f.cutoff;
        const prior =
          month >= (f.endYear - 1) * 100 + 1 &&
          month <= (f.endYear - 1) * 100 + f.cutoff;
        if (current || prior) {
          const bucket = current ? items : oldItems;
          if (current) currentRecords++;
          const key = JSON.stringify([id, p, item || name]);
          if (!bucket.has(key))
            bucket.set(key, {
              id: item || "",
              category: id,
              p,
              name: name || "未命名商品",
              brand: brand || "未识别品牌",
              g: 0,
              q: 0,
              valid: true,
              last: month,
            });
          const v = bucket.get(key);
          v.g += g;
          v.q += q ?? 0;
          v.valid &&= Number.isFinite(q);
          if (month >= v.last) {
            v.name = name || "未命名商品";
            v.brand = brand || "未识别品牌";
            v.last = month;
          }
        }
      }
    },
    finish() {
      const rows = (map) =>
        [...map].map(([k, v]) => [...JSON.parse(k), v.g, v.valid ? v.q : null]);
      const industry = {
        categories: categories.filter((c) => f.ids.includes(c.id)),
        rows: rows(market),
      };
      const m = marketTrends(industry, f),
        b = compareBrands([rows(brands)], f),
        p = priceSummary(
          rows(prices),
          [rows(brandprices)],
          industry.categories,
          f,
        );
      const all = [...items.values()].sort(
        (a, b) =>
          b.g - a.g ||
          (a.category + "|" + a.p + "|" + (a.id || a.name) <
          b.category + "|" + b.p + "|" + (b.id || b.name)
            ? -1
            : 1),
      );
      const info = {
        matchedRecords,
        scanned,
        currentRecords,
        products: all.length,

        rule: f.rule?.text || "全部商品",
      };
      const previous = [...oldItems.values()].sort(
        (a, b) =>
          b.g - a.g ||
          (a.category + "|" + a.p + "|" + (a.id || a.name) <
          b.category + "|" + b.p + "|" + (b.id || b.name)
            ? -1
            : 1),
      );
      const total = all.reduce((s, v) => s + v.g, 0),
        oldTotal = previous.reduce((s, v) => s + v.g, 0);
      info.top = all
        .slice(0, 10)
        .map((v) => ({ ...v, share: total > 0 ? v.g / total : null }));
      info.oldTop = previous
        .slice(0, 10)
        .map((v) => ({ ...v, share: oldTotal > 0 ? v.g / oldTotal : null }));
      info.total = total;
      info.oldTotal = oldTotal;
      m.productInfo = info;
      return [{ market: m }, { brands: b }, { prices: p }];
    },
  };
}
