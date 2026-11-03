import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".gz": "application/gzip",
};
http
  .createServer((req, res) => {
    let name = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (name === "/") name = "/index.html";
    if (
      !/^\/(index\.html|app\.js|styles\.css|lib\/[\w.-]+\.js|data\/[\w./-]+)$/.test(
        name,
      ) ||
      name.includes("..")
    ) {
      res.writeHead(404);
      return res.end();
    }
    const file = path.join(root, name);
    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  })
  .listen(8765, "127.0.0.1", () => console.log("Local: http://127.0.0.1:8765"));
