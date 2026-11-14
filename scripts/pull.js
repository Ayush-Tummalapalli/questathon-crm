// Fetch everything ONCE (one call a minute) and save to data/raw/. Resumable: re-run to continue.
// node scripts/pull.js
import "../src/env.js";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { callTool } from "../src/mcp.js";

const DIR = new URL("../data/raw/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const file = (n) => DIR + n.replace(/[^\w.-]+/g, "_") + ".json";
const have = (n) => existsSync(file(n));
const load = (n) => JSON.parse(readFileSync(file(n), "utf8"));
const save = (n, v) => writeFileSync(file(n), JSON.stringify(v, null, 2));

async function step(label, name, args = {}) {
  if (have(label)) { console.log("have", label); return load(label); }
  process.stdout.write(`fetching ${label} ... `);
  const v = await callTool(name, args);
  save(label, v);
  console.log("saved");
  return v;
}

// Collect every object that has an id inside any "files" array, wherever it sits.
function findFileIds(node, out = new Set()) {
  if (Array.isArray(node)) node.forEach((x) => findFileIds(x, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "files" && Array.isArray(v)) v.forEach((f) => f && f.id && out.add(String(f.id)));
      findFileIds(v, out);
    }
  }
  return out;
}

const accounts = await step("get_my_accounts", "get_my_accounts");
await step("get_data_format", "get_data_format");
const ids = (Array.isArray(accounts) ? accounts : accounts.accounts ?? Object.values(accounts)).map((a) => a?.account ?? a?.id).filter(Boolean);
const keys = ids.length ? ids : ["A", "B"];
for (const k of keys) await step(`paperwork_${k}`, "get_all_paperwork", { account: k });
await step("get_feature_requests", "get_feature_requests");
await step("get_release_notes", "get_release_notes");
await step("get_flytbase_team", "get_flytbase_team");
await step("get_signals", "get_signals");
for (const id of findFileIds(accounts)) await step(`file_${id}`, "get_file", { id });
console.log("done");
