// Keeps the CRM live. One MCP call a minute in total (the game's limit), token stays on this server.
//  - every poll: get_signals (new events); every 5th poll: get_my_accounts and compare a hash
//  - anything changed -> re-pull accounts, paperwork and files into data/raw, reload, re-analyse
//  - when the ranked first moves change, write them back with write_note (kind next_step)
import "./env.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { callTool } from "./mcp.js";
import { loadWorld } from "./world.js";
import { analyze } from "./analyze.js";

const RAW = new URL("../data/raw/", import.meta.url).pathname;
const STATE = new URL("../data/live_state.json", import.meta.url).pathname;
const hash = (v) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 10);
const save = (n, v) => { mkdirSync(RAW, { recursive: true }); writeFileSync(RAW + n.replace(/[^\w.-]+/g, "_") + ".json", JSON.stringify(v, null, 2)); };

export const status = {
  tokenConfigured: !!process.env.AQ_TOKEN, polls: 0, lastPoll: null, lastChange: null, lastRefresh: null,
  signalsSeen: 0, notesWritten: 0, lastError: null, busy: "", log: [],
};
const say = (m) => { status.log.unshift({ at: new Date().toISOString(), m }); status.log.length = 30; console.log("[live]", m); };

let state = { exportHash: null, signalHash: null, noteFps: {} };
try { if (existsSync(STATE)) state = { ...state, ...JSON.parse(readFileSync(STATE, "utf8")) }; } catch {}
const persist = () => { try { writeFileSync(STATE, JSON.stringify(state)); } catch {} };

export let current = null;
export function recompute() {
  const world = loadWorld();
  current = analyze(world, new Date());
  return current;
}

async function refreshAll(reason) {
  status.busy = "refreshing: " + reason; say("refreshing (" + reason + ")");
  const accounts = await callTool("get_my_accounts"); save("get_my_accounts", accounts);
  state.exportHash = hash(accounts);
  for (const a of accounts.accounts) { save(`paperwork_${a.id}`, await callTool("get_all_paperwork", { account: a.id })); }
  for (const f of accounts.files ?? []) {
    if (!existsSync(RAW + `file_${f.id}.json`)) save(`file_${f.id}`, await callTool("get_file", { id: f.id }));
  }
  recompute();
  status.lastRefresh = new Date().toISOString(); status.lastChange = status.lastRefresh; status.busy = "";
  say("taken in new data without a code change");
  await writeBack();
  persist();
}

// Write the first three moves back, only when they changed since the last write.
async function writeBack() {
  if (!process.env.AQ_TOKEN || process.env.AQ_WRITE_NOTES === "0" || !current) return;
  for (const acc of current.accounts) {
    const moves = acc.q3.moves.slice(0, 3);
    const fp = hash(moves.map((m) => [m.deal, m.due, m.rank]));
    if (state.noteFps[acc.id] === fp) continue;
    status.busy = "writing notes";
    for (const m of moves) {
      const text = `#${m.rank} ${m.title} | owner: ${m.owner.flytbase}${m.owner.customer ? " + " + m.owner.customer.name : ""} | due ${m.due} | deal ${m.deal}` +
        ` | worth up to ${m.value?.value ?? "unsized"} | sources: ${m.cites.slice(0, 6).join(", ")} [crm:${acc.id}:${fp}]`;
      try {
        await callTool("write_note", { account: acc.id, kind: "next_step", title: `CRM move #${m.rank}`, text });
        status.notesWritten++;
      } catch (e) { status.lastError = String(e.message).slice(0, 200); say("write_note failed: " + status.lastError); return; }
    }
    state.noteFps[acc.id] = fp; persist(); say(`wrote ${moves.length} next steps for account ${acc.id}`);
  }
  status.busy = "";
}

let tick = 0;
async function poll() {
  try {
    status.busy = "polling"; tick++; status.polls = tick;
    if (tick % 5 === 0) {
      const accounts = await callTool("get_my_accounts");
      status.lastPoll = new Date().toISOString();
      if (state.exportHash && hash(accounts) !== state.exportHash) { save("get_my_accounts", accounts); await refreshAll("accounts changed"); }
      else { state.exportHash = hash(accounts); }
    } else {
      const sig = await callTool("get_signals");
      status.lastPoll = new Date().toISOString();
      const list = Array.isArray(sig) ? sig : sig?.signals ?? [];
      status.signalsSeen = list.length;
      const h = hash(list);
      if (state.signalHash !== null && h !== state.signalHash && list.length) { save("get_signals", sig); state.signalHash = h; await refreshAll("new signals"); }
      state.signalHash = h;
    }
    status.lastError = null; status.busy = ""; persist();
  } catch (e) { status.lastError = String(e.message).slice(0, 200); status.busy = ""; say("poll error: " + status.lastError); }
}

export function startLive() {
  recompute();
  if (!process.env.AQ_TOKEN) { say("no AQ_TOKEN: serving the committed snapshot, live loop off"); return; }
  say("live loop on; the token stays on the server");
  (async () => {
    try { // after a restart on a host with a fresh disk, learn which moves are already written
      const notes = await callTool("list_notes");
      for (const m of JSON.stringify(notes).matchAll(/\[crm:(\w+):(\w+)\]/g)) state.noteFps[m[1]] = m[2];
      persist();
    } catch (e) { say("list_notes failed: " + String(e.message).slice(0, 120)); }
    await writeBack().catch(() => {}); for (;;) { await poll(); await new Promise((r) => setTimeout(r, 65_000)); } })();
}
