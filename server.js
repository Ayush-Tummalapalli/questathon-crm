import "./src/env.js";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { startLive, status, current } from "./src/live.js";
import * as live from "./src/live.js";

const PUB = new URL("./public/", import.meta.url).pathname;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
startLive();

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/crm") { const c = live.current; return json({ ...c, live: status }); }
  if (url.pathname === "/api/status") return json(status);
  if (url.pathname === "/health") return json({ ok: true });
  let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  if (p === "/" || p === "") p = "/index.html";
  const f = join(PUB, p);
  if (f.startsWith(PUB) && existsSync(f)) { res.writeHead(200, { "content-type": types[extname(f)] ?? "text/plain" }); return res.end(readFileSync(f)); }
  res.writeHead(404); res.end("not found");
}).listen(process.env.PORT || 3000, () => console.log("CRM on", process.env.PORT || 3000));
