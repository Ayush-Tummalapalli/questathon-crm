// Tiny .env loader so the project runs on any Node 18+ (no --env-file flag needed).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^['"]|['"]$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch { /* no .env: the host provides real environment variables */ }
