// Decode compressed data away from the rendering thread. Abort stale network work.
const controllers = new Map();
self.onmessage = async ({ data: m }) => {
  if (m.type === "cancel") {
    for (const [id, entry] of controllers)
      if (!entry.persistent) {
        entry.controller.abort();
        controllers.delete(id);
      }
    return;
  }
  if (m.type !== "load") return;
  const controller = new AbortController();
  controllers.set(m.id, { controller, persistent: !!m.persistent });
  try {
    const response = await fetch(m.url, { signal: controller.signal });
    if (!response.ok) throw Error("数据请求失败：" + response.status);
    const bytes = await response.arrayBuffer(),
      head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
    const text =
      head[0] === 31 && head[1] === 139
        ? await new Response(
            new Response(bytes).body.pipeThrough(
              new DecompressionStream("gzip"),
            ),
          ).text()
        : new TextDecoder().decode(bytes);
    let result = JSON.parse(text);
    if (result.labels && result.rows) {
      const { labels, rows } = result;
      for (const r of rows) r[2] = labels[r[2]];
      result = rows;
    }
    if (!controller.signal.aborted) self.postMessage({ id: m.id, result });
  } catch (error) {
    self.postMessage({
      id: m.id,
      error: error.name === "AbortError" ? "cancelled" : error.message,
    });
  } finally {
    controllers.delete(m.id);
  }
};
