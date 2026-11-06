import {
  prepareCompetitionChunk,
  summarizeCompetition,
} from "./competition-data.js?v=2.6.1";
const chunks = new Map(),
  inflight = new Map(),
  results = new Map();
let latest = 0;
async function load(url) {
  if (chunks.has(url)) {
    const c = chunks.get(url);
    chunks.delete(url);
    chunks.set(url, c);
    return c;
  }
  if (inflight.has(url)) return inflight.get(url);
  const promise = (async () => {
    const r = await fetch(url);
    if (!r.ok) throw Error("价格带数据请求失败 " + r.status);
    const bytes = await r.arrayBuffer(),
      head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    const text =
      head[0] === 31 && head[1] === 139
        ? await new Response(
            new Response(bytes).body.pipeThrough(
              new DecompressionStream("gzip"),
            ),
          ).text()
        : new TextDecoder().decode(bytes);
    const chunk = prepareCompetitionChunk(JSON.parse(text));
    chunks.set(url, chunk);
    let size = [...chunks.values()].reduce((s, c) => s + c.size, 0);
    while (size > 3000000 && chunks.size > 1) {
      const key = chunks.keys().next().value;
      size -= chunks.get(key).size;
      chunks.delete(key);
    }
    return chunk;
  })().finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
self.onmessage = async ({ data: m }) => {
  if (m.type === "cancel") {
    latest++;
    return;
  }
  if (m.type !== "competition") return;
  const ticket = ++latest,
    key = JSON.stringify({ ...m, id: undefined });
  if (results.has(key)) {
    self.postMessage({ id: m.id, result: results.get(key) });
    return;
  }
  try {
    const parts = new Array(m.files.length);
    let next = 0,
      done = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, m.files.length) }, async () => {
        while (next < m.files.length && ticket === latest) {
          const i = next++;
          parts[i] = await load(m.files[i].url);
          if (ticket === latest)
            self.postMessage({
              id: m.id,
              progress: ++done,
              total: m.files.length,
            });
        }
      }),
    );
    if (ticket !== latest) return;
    const result = await summarizeCompetition(
      parts,
      m,
      () => ticket === latest,
    );
    if (!result || ticket !== latest) return;
    results.set(key, result);
    while (results.size > 24) results.delete(results.keys().next().value);
    self.postMessage({ id: m.id, result });
  } catch (e) {
    if (ticket === latest) self.postMessage({ id: m.id, error: e.message });
  }
};
