// Loads everything the MCP gave us into one "world" object. Works from data/raw/ (snapshot) so the
// hosted app can start instantly; the live loop (src/live.js) overwrites pieces as they refresh.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { parseCsv } from "./util.js";

const RAW = new URL("../data/raw/", import.meta.url).pathname;
const rd = (n) => (existsSync(RAW + n) ? JSON.parse(readFileSync(RAW + n, "utf8")) : null);

export function loadWorld() {
  const exp = rd("get_my_accounts.json");
  if (!exp) throw new Error("No data/raw/get_my_accounts.json yet. Run: node scripts/pull.js");
  const paperwork = {};
  for (const a of exp.accounts) {
    const pw = rd(`paperwork_${a.id}.json`);
    const byPath = {};
    for (const r of pw?.records ?? []) {
      const rec = { ...r };
      if (r.data !== undefined) rec.json = r.data;
      else if (r.path.endsWith(".json")) { try { rec.json = JSON.parse(r.text); } catch {} }
      if (r.path.endsWith(".csv") && typeof r.text === "string") rec.rows = parseCsv(r.text);
      byPath[r.path] = rec;
    }
    paperwork[a.id] = byPath;
  }
  const files = {};
  for (const f of exp.files) {
    const j = rd(`file_${f.id}.json`);
    if (j) files[f.id] = { ...f, text: j.text ?? "", rows: (j.name ?? "").endsWith(".csv") ? parseCsv(j.text ?? "") : null };
  }
  const sig = rd("get_signals.json");
  return {
    export: exp, paperwork, files,
    team: rd("get_flytbase_team.json")?.people ?? [],
    featureRequests: rd("get_feature_requests.json"),
    releaseNotes: rd("get_release_notes.json"),
    signals: Array.isArray(sig) ? sig : sig?.signals ?? [],
  };
}
