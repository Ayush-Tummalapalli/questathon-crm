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
// The game stamps every export with the time it was made; that must not count as a change.
const stable = (v) => { if (v && typeof v === "object" && !Array.isArray(v)) { const { exported_at, generated_at, fetched_at, ...rest } = v; return rest; } return v; };
const hash = (v) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 10);
const save = (n, v) => { mkdirSync(RAW, { recursive: true }); writeFileSync(RAW + n.replace(/[^\w.-]+/g, "_") + ".json", JSON.stringify(v, null, 2)); };

export const status = {
  tokenConfigured: !!process.env.AQ_TOKEN, polls: 0, lastPoll: null, lastChange: null, lastRefresh: null,
  signalsSeen: 0, notesWritten: 0, lastError: null, busy: "", log: [], feed: [], nextPoll: null, startedAt: new Date().toISOString(),
};
const addFeed = (kind, text) => { status.feed.unshift({ at: new Date().toISOString(), kind, text }); if (status.feed.length > 60) status.feed.length = 60; };
const say = (m) => { status.log.unshift({ at: new Date().toISOString(), m }); status.log.length = 30; console.log("[live]", m); };

let state = { exportHash: null, signalHash: null, noteFps: {} };
try { if (existsSync(STATE)) state = { ...state, ...JSON.parse(readFileSync(STATE, "utf8")) }; } catch {}
if (state.hv !== 2) { state.exportHash = null; state.hv = 2; } // hash definition changed
const persist = () => { try { writeFileSync(STATE, JSON.stringify(state)); } catch {} };

export let current = null;
let world = null;
export function recompute() {
  world = loadWorld();
  current = analyze(world, new Date());
  return current;
}

const K = (n) => (n >= 1e6 ? "€" + (n / 1e6).toFixed(2) + "M" : "€" + Math.round(n / 1e3) + "k");
function digest() {
  const d = {};
  for (const a of world.export.accounts) {
    const ca = current.accounts.find((x) => x.id === a.id);
    d[a.id] = {
      name: a.name, facts: Object.fromEntries(a.facts.map((f) => [f.id, f.text])),
      opps: Object.fromEntries(a.opportunities.map((o) => [o.id, { t: o.title, s: `${o.stage}${o.blocker ? ", blocker " + o.blocker.status : ""}` }])),
      offers: Object.fromEntries((a.offers ?? []).map((o) => [o.id, { t: o.title, s: o.status }])),
      moves: ca.q3.moves.map((m) => m.title), backed: ca.q1.totals.recurring.value + ca.q1.totals.closedExpansion.value,
      risks: ca.q4.risks.map((r) => r.what), records: Object.fromEntries(Object.entries(world.paperwork[a.id]).map(([p, r]) => [p, hash(r.json ?? r.rows ?? r.text ?? "")])),
    };
  }
  return d;
}
function diffDigest(p, n) {
  const out = [];
  for (const id of Object.keys(n)) {
    const x = p[id], y = n[id]; if (!x) { out.push(`New account in the data: ${y.name}`); continue; }
    const nf = Object.keys(y.facts).filter((k) => !(k in x.facts)); if (nf.length) out.push(`${id}: ${nf.length} new fact${nf.length > 1 ? "s" : ""} learned, e.g. "${y.facts[nf[0]].slice(0, 90)}"`);
    for (const k of Object.keys(y.opps)) { if (!x.opps[k]) out.push(`${id}: new deal "${y.opps[k].t}"`); else if (x.opps[k].s !== y.opps[k].s) out.push(`${id}: "${y.opps[k].t}" moved from ${x.opps[k].s} to ${y.opps[k].s}`); }
    for (const k of Object.keys(y.offers)) { if (!x.offers[k]) out.push(`${id}: new offer "${y.offers[k].t}"`); else if (x.offers[k].s !== y.offers[k].s) out.push(`${id}: offer "${y.offers[k].t}" is now ${y.offers[k].s}`); }
    if (x.backed !== y.backed) out.push(`${id}: backed book changed from ${K(x.backed)} to ${K(y.backed)}`);
    if (JSON.stringify(x.moves) !== JSON.stringify(y.moves)) out.push(`${id}: first moves re-ranked, now: ${y.moves.map((m, i) => `${i + 1}. ${m.slice(0, 50)}`).join("; ")}`);
    for (const r of y.risks.filter((r) => !x.risks.includes(r)).slice(0, 3)) out.push(`${id}: new risk: ${r.slice(0, 100)}`);
    for (const r of x.risks.filter((r) => !y.risks.includes(r)).slice(0, 3)) out.push(`${id}: risk gone: ${r.slice(0, 100)}`);
    const ch = Object.keys(y.records).filter((k) => x.records[k] !== y.records[k]); if (ch.length) out.push(`${id}: records changed: ${ch.slice(0, 5).join(", ")}`);
  }
  return out;
}

async function refreshAll(reason) {
  status.busy = "refreshing: " + reason; say("refreshing (" + reason + ")");
  const before = digest(); addFeed("data", `New data detected (${reason}). Pulling accounts and records.`);
  const accounts = await callTool("get_my_accounts"); save("get_my_accounts", accounts);
  state.exportHash = hash(stable(accounts));
  for (const a of accounts.accounts) { save(`paperwork_${a.id}`, await callTool("get_all_paperwork", { account: a.id })); }
  for (const f of accounts.files ?? []) {
    if (!existsSync(RAW + `file_${f.id}.json`)) save(`file_${f.id}`, await callTool("get_file", { id: f.id }));
  }
  recompute();
  status.lastRefresh = new Date().toISOString(); status.lastChange = status.lastRefresh; status.busy = "";
  say("taken in new data without a code change");
  const changes = diffDigest(before, digest());
  if (changes.length) changes.forEach((c) => addFeed("data", c)); else addFeed("data", "Re-read every record: nothing the answers depend on changed.");
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
        status.notesWritten++; addFeed("note", `Wrote next step to the game for ${acc.id}: #${m.rank} ${m.title.slice(0, 70)}, due ${m.due}`);
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
      if (state.exportHash && hash(stable(accounts)) !== state.exportHash) { save("get_my_accounts", accounts); await refreshAll("accounts changed"); }
      else { state.exportHash = hash(stable(accounts)); }
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
  if (!process.env.AQ_TOKEN) { say("no AQ_TOKEN: serving the committed snapshot, live loop off"); addFeed("system", "No token on this server, so it is showing the saved snapshot."); return; }
  say("live loop on; the token stays on the server");
  addFeed("system", "Live loop started. Checking the game for new data about once a minute.");
  (async () => {
    try { // after a restart on a host with a fresh disk, learn which moves are already written
      const notes = await callTool("list_notes");
      let found = 0;
      for (const m of JSON.stringify(notes).matchAll(/\[crm:(\w+):(\w+)\]/g)) { state.noteFps[m[1]] = m[2]; found++; }
      if (found) { status.notesWritten += found; addFeed("note", `${found} next-step notes written earlier are already in the game, so they are not repeated.`); }
      persist();
    } catch (e) { say("list_notes failed: " + String(e.message).slice(0, 120)); }
    await writeBack().catch(() => {}); for (;;) { await poll(); status.nextPoll = new Date(Date.now() + 65_000).toISOString(); await new Promise((r) => setTimeout(r, 65_000)); } })();
}

// Exposed for scripts/test-diff.js only.
export const _test = { digest, diffDigest, getWorld: () => world, reanalyze: () => { current = analyze(world, new Date()); } };
