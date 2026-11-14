// Turns the world into five answers per account. Rules:
//  - every number carries cites (ids that exist in `refs`); n() throws if it has none.
//  - nothing is hardcoded to an account, person or file name: it reads the schema's structures.
//  - claims, told and verified are kept apart; unverified things go to "don't know".
import { daysBetween, addDays, isoDay, parseMonth, entityKey } from "./util.js";

export function analyze(world, asOf = new Date()) {
  const today = isoDay(asOf);
  const refs = buildRefs(world);
  const cite = (id) => {
    if (!refs[id]) throw new Error(`invented id: ${id}`);
    return id;
  };
  const cites = (...ids) => [...new Set(ids.flat().filter(Boolean))].map(cite);
  const n = (value, ...ids) => {
    const c = cites(...ids);
    if (!c.length) throw new Error("number with no source: " + value);
    return { value, cites: c };
  };

  const accounts = world.export.accounts.map((a) => {
    const pw = world.paperwork[a.id] ?? {};
    const profile = pw["profile.json"]?.json;
    const factBy = Object.fromEntries(a.facts.map((f) => [f.id, f]));
    const stakeholderByName = Object.fromEntries(a.stakeholders.map((s) => [s.name.toLowerCase(), s]));
    const acctFiles = Object.values(world.files).filter((f) => f.account === a.id);
    const inv = pw["invoices.json"]?.json?.invoices ?? [];
    const tickets = pw["tickets.json"]?.json?.tickets ?? [];
    const requests = pw["requests.csv"]?.rows ?? [];
    const users = pw["users.json"]?.json?.users ?? [];
    const devices = pw["devices.json"]?.json?.docks ?? [];
    const usage = pw["usage_weekly.csv"]?.rows ?? [];
    const events = pw["device_events.csv"]?.rows ?? [];
    const contractText = pw["contract.txt"]?.text ?? "";
    const termEnd = profile?.renewal?.term_ends ?? null;
    const annual = profile?.renewal?.annual_value ?? null;
    const profileRef = `${a.id}:profile.json`;

    // ---------- evidence strength for an id ----------
    const strength = (id) => {
      if (world.files[id]) return "file";
      const f = factBy[id];
      return f ? f.status : null;
    };
    const backing = (evidence) => {
      const s = evidence.map(strength);
      if (s.includes("verified") || s.includes("file")) return "backed";
      if (s.includes("told")) return "partial";
      return "unbacked";
    };

    // ---------- Q1: what is the book worth ----------
    const lines = [];
    if (annual != null) lines.push({
      id: "contract", title: "Current contract (annual)", kind: "contract", status: termEnd ? `term ends ${termEnd}` : "in term",
      value: n(annual, profileRef, pw["contract.txt"] ? `${a.id}:contract.txt` : null), backing: "backed",
      why: "Signed order form and paid invoices.", evidence: [],
    });
    for (const o of a.opportunities) {
      lines.push({
        id: o.id, title: o.title, kind: "opportunity", status: o.stage + (o.blocker ? `, blocker ${o.blocker.status}` : ""),
        value: o.worth_up_to != null ? n(o.worth_up_to, o.id) : null,
        backing: o.worth_up_to != null ? backing(o.evidence) : "no value yet",
        why: o.worth_up_to != null ? backingWhy(o.evidence, strength) : "Not yet sized.",
        evidence: o.evidence.map((id) => ({ id: cite(id), strength: strength(id) })),
      });
    }
    for (const f of a.offers ?? []) {
      lines.push({
        id: f.id, title: f.title, kind: "offer", status: f.status + (f.pitch_to ? ` · to ${f.pitch_to}` : ""),
        value: n(f.value, f.id), backing: f.status === "won" ? "closed" : f.status === "declined" ? "declined" : "pipeline",
        why: f.status === "won" ? "Agreed." : f.status === "declined" ? "Declined." : "Needs trust plus a stated need.", evidence: [],
      });
    }
    const sum = (pred) => lines.filter(pred).reduce((t, l) => t + (l.value?.value ?? 0), 0);
    const idsOf = (pred) => lines.filter(pred).map((l) => l.id);
    const totals = {
      recurring: annual != null ? n(annual, profileRef) : null,
      closedExpansion: n(sum((l) => l.kind === "offer" && l.backing === "closed") + sum((l) => l.kind === "opportunity" && l.status.startsWith("agreed")),
        ...idsOf((l) => (l.kind === "offer" && l.backing === "closed") || (l.kind === "opportunity" && l.status.startsWith("agreed"))), profileRef),
      renewalAtStake: n(sum((l) => l.kind === "opportunity" && /renew/i.test(l.title) && !l.status.startsWith("agreed")), ...idsOf((l) => l.kind === "opportunity" && /renew/i.test(l.title) && !l.status.startsWith("agreed")), profileRef),
      pipelineBacked: n(sum((l) => l.kind === "opportunity" && !/renew/i.test(l.title) && !l.status.startsWith("agreed") && l.backing === "backed"), ...idsOf((l) => l.kind === "opportunity" && !/renew/i.test(l.title) && !l.status.startsWith("agreed") && l.backing === "backed"), profileRef),
      pipelinePartial: n(sum((l) => l.kind === "opportunity" && !/renew/i.test(l.title) && !l.status.startsWith("agreed") && l.backing === "partial"), ...idsOf((l) => l.kind === "opportunity" && !/renew/i.test(l.title) && !l.status.startsWith("agreed") && l.backing === "partial"), profileRef),
      pipelineUnbacked: n(sum((l) => l.kind === "opportunity" && !/renew/i.test(l.title) && !l.status.startsWith("agreed") && l.backing === "unbacked"), ...idsOf((l) => l.kind === "opportunity" && !/renew/i.test(l.title) && !l.status.startsWith("agreed") && l.backing === "unbacked"), profileRef),
      offersOpen: n(sum((l) => l.kind === "offer" && l.backing === "pipeline"), ...idsOf((l) => l.kind === "offer" && l.backing === "pipeline"), profileRef),
    };
    // claims shown apart, beside what the record says
    const claims = a.facts.filter((f) => f.status === "claim").map((f) => {
      const prefix = f.id.replace(/_\d+$/, "");
      const rest = a.facts.filter((g) => g.id !== f.id && g.id.replace(/_\d+$/, "") === prefix && g.status !== "claim");
      return { claim: f.id, said_by: f.said_by, text: f.text, record: rest.map((g) => ({ id: g.id, status: g.status, text: g.text })), cites: cites(f.id, rest.map((g) => g.id)) };
    });
    const activity = acctFiles.map((f) => summariseActivity(f, a.name, cite)).filter(Boolean);
    const usageSummary = summariseDocks({ a, devices, usage, today, cites, n, cite, refs });

    const q1 = { story: { text: a.official_story, note: "Account sheet. Unverified.", cites: [] }, lines, totals, claims, activity, usage: usageSummary };

    // ---------- Q2: who holds the power ----------
    const tagRules = [
      ["decides", /(approve|sign[- ]?off|sign(ed)?\b|decid|authoris|commit|runs the allocation|sets)/i],
      ["pays", /(budget|fund|pay|paid|cost|charge|allocation|invoice)/i],
      ["uses", /(fly|flies|flew|use[sd]?\b|operator|patrol|dock)/i],
      ["could block", /(cannot|can't|not (?:be )?signed|never|nobody|resent|does not|won't|no view|not mine|waiting|unanswered)/i],
    ];
    const lastContact = Object.fromEntries((profile?.contacts_on_file ?? []).map((c) => [c.id, c]));
    const personRow = (s, factsForPerson) => {
      const tags = {};
      for (const f of factsForPerson) for (const [tag, re] of tagRules) if (re.test(f.text)) (tags[tag] ??= []).push(f.id);
      const u = users.find((x) => x.name && x.name === s.name);
      return {
        id: cite(s.id), name: s.name, role: s.role, relationship: s.relationship, available: s.available !== false,
        tags: Object.entries(tags).map(([tag, ids]) => ({ tag, cites: cites(ids) })),
        lastContact: lastContact[s.id] ? { date: lastContact[s.id].last_contact_before_handover, note: lastContact[s.id].note, cite: cite(profileRef) } : null,
        signIns: u ? { last: u.last_sign_in, last90: u.sign_ins_last_90_days, cite: cite(`${a.id}:${u.user_id}`) } : null,
        sayings: factsForPerson.map((f) => ({ id: f.id, status: f.status })),
      };
    };
    const perDeal = a.opportunities.map((o) => {
      const involved = new Map();
      const add = (s, why) => { if (s) { const e = involved.get(s.id) ?? { s, why: new Set() }; e.why.add(why); involved.set(s.id, e); } };
      for (const id of o.evidence) { const f = factBy[id]; if (f) add(stakeholderByName[f.said_by.toLowerCase()], `spoke to ${id}`); }
      const textForMatch = `${o.title} ${o.blocker?.text ?? ""}`.toLowerCase();
      for (const s of a.stakeholders) if (textForMatch.includes(s.name.toLowerCase())) add(s, "named in the deal");
      for (const f of a.offers ?? []) if (f.pitch_to) add(stakeholderByName[f.pitch_to.replace(/^Insp\.\s*/, "").toLowerCase()] ?? a.stakeholders.find((s) => s.name.includes(f.pitch_to.split(" ").pop())), `offer ${f.id} goes to them`);
      const people = [...involved.values()].map(({ s, why }) => {
        const fs = o.evidence.map((id) => factBy[id]).filter((f) => f && f.said_by === s.name);
        const row = personRow(s, fs); row.why = [...why]; return row;
      });
      return { deal: cite(o.id), title: o.title, stage: o.stage, blocker: o.blocker, people };
    });
    const notOnFile = (profile?.not_on_file ?? []).map((t, i) => ({ text: t, cites: cites(profileRef) }));
    const q2 = {
      people: a.stakeholders.map((s) => personRow(s, a.facts.filter((f) => f.said_by === s.name))),
      perDeal, notOnFile,
      note: "Roles marked 'inferred' come from keywords in the quoted facts; the fact ids are shown so you can check them.",
    };

    // A ticket/request counts as handled when an agreed or cleared deal's evidence mentions it, or its words overlap the deal title.
    const toks = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 3 && !["request","email","asked","about","from","with","that","this","have","their","sent","docks","dock"].includes(w)));
    const handledBy = (idOrText, summary) => {
      for (const o of a.opportunities) {
        const done = o.stage === "agreed" || o.stage === "cleared" || o.blocker?.status === "cleared";
        if (!done) continue;
        const evText = o.evidence.map((id) => factBy[id]?.text ?? world.files[id]?.text ?? "").join(" ");
        if (idOrText && evText.includes(idOrText)) return o;
        const a1 = toks(summary), b1 = toks(o.title); let hit = 0; a1.forEach((w) => b1.has(w) && hit++);
        if (hit >= 2) return o;
      }
      return null;
    };
    // ---------- Q4 inputs: risks ----------
    const risks = [];
    const risk = (severity, what, when, why, ...ids) => risks.push({ severity, what, when, why, cites: cites(...ids) });
    if (termEnd) {
      const left = daysBetween(today, termEnd);
      const noAuto = /no automatic renewal/i.test(contractText);
      risk(left <= 60 ? "high" : left <= 120 ? "medium" : "low",
        `Contract ends ${termEnd}${noAuto ? " and does not renew by itself" : ""}`, termEnd,
        `${left} days left on a ${annual != null ? annual.toLocaleString("en-GB") + " a year" : ""} order.`.trim(), profileRef, `${a.id}:contract.txt`);
    }
    a.deadlines.forEach((d, i) => risk(d.passed ? "high" : "medium", d.text, d.minute != null ? `minute ${d.minute}` : "undated", d.passed ? "Already passed." : "No date given: needs one.", `${a.id}:deadline:${i}`));
    for (const t of tickets.filter((x) => !/closed|resolved/i.test(x.status))) {
      const age = daysBetween(t.opened, today);
      const h = handledBy(t.id, t.subject);
      if (h) { risk("low", `Ticket ${t.id} ("${t.subject}") looks handled through "${h.title}"`, "confirm", "Deal evidence points at it; check the ticket is actually closed on the support side.", t.id, h.id); continue; }
      risk(age > 30 ? "high" : "medium", `Ticket ${t.id} still ${t.status.toLowerCase()}: ${t.subject}`, `${age} days open`, t.first_response_hours == null ? "No first response recorded." : `First response after ${t.first_response_hours}h.`, t.id);
    }
    const ticketIds = new Set((typeof tickets !== "undefined" ? tickets : []).map((t) => t.id));
    const openReqs = requests.filter((x) => /open|pending/i.test(x.status)).filter((r) => !ticketIds.has(r.request_id)).filter((r) => {
      const h = handledBy(r.request_id && r.request_id !== "(none)" ? r.request_id : null, r.summary);
      if (h) { risk("low", `Request "${r.summary.slice(0, 80)}" looks handled through "${h.title}"`, "confirm", "A deal that covers it is already agreed.", `${a.id}:request:${r.request_id && r.request_id !== "(none)" ? r.request_id : requests.indexOf(r)}`, h.id); return false; }
      return true;
    });
    for (const r of openReqs) {
      const age = r.last_update ? daysBetween(r.last_update, today) : null;
      risk(!r.owner ? "high" : "medium", `Open request${r.request_id && r.request_id !== "(none)" ? " " + r.request_id : ""} from ${r.from}: ${r.summary}`, age != null ? `${age} days since last update` : "undated",
        !r.owner ? "Nobody owns it." : `Owner: ${r.owner}.`, `${a.id}:request:${r.request_id && r.request_id !== "(none)" ? r.request_id : requests.indexOf(r)}`);
    }
    for (const c of profile?.contacts_on_file ?? []) {
      const gap = c.last_contact_before_handover ? daysBetween(c.last_contact_before_handover, today) : null;
      const metNow = a.facts.some((f) => f.said_by === c.name);
      if (gap != null && gap > 30 && !metNow) risk(gap > 60 ? "high" : "medium", `${c.name} going cold`, `${gap} days since contact`, c.note ?? "", profileRef);
    }
    for (const u of users.filter((x) => x.sign_ins_last_90_days === 0)) risk("medium", `${u.name ?? u.role} has not signed in for 90+ days`, `last ${u.last_sign_in}`, u.role, `${a.id}:${u.user_id}`);
    for (const i of inv.filter((x) => !/paid/i.test(x.status))) risk("high", `Invoice ${i.number} ${i.status}`, i.issued, i.what, i.number);
    const stale = devices.filter((d) => d.last_seen_online && daysBetween(d.last_seen_online, today) > 7);
    if (stale.length) risk("high", `${stale.length} dock(s) not seen online for over a week`, "now", stale.map((d) => d.dock_id).join(", "), ...stale.map((d) => `${a.id}:${d.dock_id}`));
    const drops = countDrops(events, today, 30);
    const worst = Object.entries(drops).sort((x, y) => y[1] - x[1]).slice(0, 3).filter(([, c]) => c >= 10);
    for (const [dock, c] of worst) risk("medium", `Dock ${dock} lost connection ${c} times in 30 days`, "last 30 days", "Repeated drops usually mean a network problem on the customer side.", `${a.id}:${dock}`, `${a.id}:device_events.csv`);
    if (usageSummary?.idle?.length) risk("medium", `${usageSummary.idle.length} dock(s) online but no flights in the last ${usageSummary.windowWeeks} weeks`, "now", "Idle docks put value and renewals at risk.", ...usageSummary.idleCites);
    risks.sort((x, y) => sev(y.severity) - sev(x.severity));
    const q4 = { risks };

    // ---------- Q3: first three moves ----------
    const leftDays = termEnd ? daysBetween(today, termEnd) : null;
    const cand = [];
    const ownerFor = (ids) => {
      const tally = {};
      for (const id of ids) { const f = factBy[id]; if (f) tally[f.said_by] = (tally[f.said_by] ?? 0) + 1; }
      const top = Object.entries(tally).sort((x, y) => y[1] - x[1])[0]?.[0];
      return top ? stakeholderByName[top.toLowerCase()] ?? null : null;
    };
    const myRole = (profile?.flytbase_side?.csm ?? []).find((c) => c.who === "you");
    for (const o of a.opportunities.filter((x) => x.stage !== "agreed")) {
      const days = o.deadline ? 14 : 30;
      const urgency = o.deadline || (leftDays != null && leftDays < 90) ? 2 : 1;
      const strong = o.evidence.filter((id) => ["verified", "file"].includes(strength(id)));
      const cust = ownerFor(o.evidence);
      cand.push({
        deal: cite(o.id), title: o.blocker?.status === "open" ? `Clear: ${o.blocker.text}` : `Move ${o.title}`, deal_title: o.title,
        value: o.worth_up_to != null ? n(o.worth_up_to, o.id) : null,
        score: (o.worth_up_to ?? 30000) * urgency * (strong.length ? 1.25 : 1),
        owner: { flytbase: "You (CSM)" + (myRole ? ` from ${myRole.from}` : ""), customer: cust ? { id: cite(cust.id), name: cust.name } : null, cite: cite(profileRef) },
        due: addDays(today, urgency === 2 ? 7 : days),
        why: [
          o.deadline ? `A deadline sits on it: ${o.deadline.text}` : null,
          strong.length ? `You already hold ${strong.length} verified source(s) for it.` : "Backed only by what people said.",
          o.blocker ? `Blocker (${o.blocker.status}): ${o.blocker.text}` : "No blocker identified yet.",
        ].filter(Boolean),
        cites: cites(o.id, ...o.evidence),
      });
    }
    for (const f of (a.offers ?? []).filter((x) => x.status === "open")) {
      const s = stakeholderByName[(f.pitch_to ?? "").replace(/^Insp\.\s*/, "").toLowerCase()] ?? a.stakeholders.find((x) => f.pitch_to && x.name.includes(f.pitch_to.split(" ").pop()));
      cand.push({ deal: cite(f.id), title: `Pitch: ${f.title}`, deal_title: f.title, value: n(f.value, f.id), score: f.value * 0.6,
        owner: { flytbase: "You (CSM)", customer: s ? { id: cite(s.id), name: s.name } : null, cite: cite(profileRef) }, due: addDays(today, 21),
        why: [`Offer is open and goes to ${f.pitch_to ?? "someone not named"}.`, "Needs trust plus a stated need before it can land."], cites: cites(f.id, s?.id) });
    }
    for (const r of openReqs) {
      const key = `${a.id}:request:${r.request_id && r.request_id !== "(none)" ? r.request_id : requests.indexOf(r)}`;
      cand.push({ deal: cite(key), title: `Reply: ${r.summary}`, deal_title: r.summary, value: null, score: 50000 * (r.owner ? 1 : 1.5),
        owner: { flytbase: r.owner || "You (CSM): nobody owns it", customer: null, cite: cite(key) }, due: addDays(today, 3),
        why: [`Open since ${r.opened}; last update ${r.last_update}.`, r.owner ? `Owner: ${r.owner}.` : "No owner."], cites: cites(key) });
    }
    cand.sort((x, y) => y.score - x.score);
    cand.forEach((c, i) => { c.due = addDays(c.due, Math.min(i, 3) * 2); if (termEnd && c.due > termEnd) c.due = termEnd; });
    const q3 = { moves: cand.slice(0, 3).map((c, i) => ({ rank: i + 1, ...c })), queue: cand.slice(3).map((c, i) => ({ rank: i + 4, ...c })),
      rule: "Score = value at stake × urgency (deadline or term under 90 days) × 1.25 if a verified source is held. Dates are inside the contract term." };

    // ---------- Q5: what we do not know ----------
    const unknown = [];
    const askFor = (text) => a.stakeholders.find((s) => text.toLowerCase().includes(s.name.toLowerCase()) || text.toLowerCase().includes(s.role.toLowerCase().split(",")[0]))
      ?? a.stakeholders.find((s) => s.relationship === "ally") ?? a.stakeholders[0];
    for (const t of profile?.not_on_file ?? []) {
      const ask = askFor(t);
      unknown.push({ what: t, why: "Recorded as missing in the account profile.", ask: ask ? { id: cite(ask.id), name: ask.name, basis: "closest stakeholder, suggested" } : null, cites: cites(profileRef) });
    }
    for (const c of claims) unknown.push({ what: `Unverified claim by ${c.said_by}: "${c.text}"`, why: c.record.length ? "The record tells a different or narrower story." : "Nothing on file backs it.", ask: (() => { const s = stakeholderByName[c.said_by.toLowerCase()]; return s ? { id: cite(s.id), name: s.name, basis: "the person who said it" } : null; })(), cites: c.cites });
    for (const o of a.opportunities.filter((x) => x.blocker?.status === "open")) {
      const s = ownerFor(o.evidence);
      unknown.push({ what: o.blocker.text, why: `Blocks "${o.title}"${o.worth_up_to != null ? " (up to " + o.worth_up_to.toLocaleString("en-GB") + ")" : ""}.`, ask: s ? { id: cite(s.id), name: s.name, basis: "spoke most about this deal" } : null, cites: cites(o.id) });
    }
    for (const o of a.opportunities.filter((x) => x.worth_up_to == null)) unknown.push({ what: `Size of "${o.title}" is not known`, why: "Shown only once qualified.", ask: null, cites: cites(o.id) });
    for (const s of a.stakeholders.filter((x) => x.available === false)) unknown.push({ what: `${s.name} is away`, why: "Cannot be asked until they are back.", ask: null, cites: cites(s.id) });
    for (const act of activity) for (const q of act.quality) unknown.push({ what: q.text, why: "Source data does not agree with itself.", ask: null, cites: cites(act.file) });
    for (const [path, rec] of Object.entries(pw)) {
      const note = rec.json?.note;
      if (typeof note === "string" && /not in this record|not on file|not recorded/i.test(note)) unknown.push({ what: note.replace(/\s+/g, " "), why: "A limit of the record itself.", ask: null, cites: cites(`${a.id}:${path}`) });
    }
    for (const act of activity) {
      if (usageSummary && act.total >= 3) {
        const a1 = act.activeCount / act.total, b1 = usageSummary.withFlights.value / usageSummary.docks;
        if (Math.abs(a1 - b1) > 0.25) unknown.push({
          what: `${usageSummary.withFlights.value} of ${usageSummary.docks} docks logged flights, but only ${act.activeCount} of ${act.total} ${act.title.toLowerCase().includes("plant") ? "plants" : "entries"} show regular live activity in ${act.title}`,
          why: "The two records disagree and nothing on file links a dock to a site, so which one is right is open.",
          ask: (() => { const s = a.stakeholders.find((x) => x.relationship === "ally") ?? a.stakeholders[0]; return s ? { id: cite(s.id), name: s.name, basis: "closest ally, suggested" } : null; })(),
          cites: cites(act.file, ...usageSummary.withFlights.cites),
        });
      }
    }
    const q5 = { unknown };

    return { id: a.id, name: a.name, q1, q2, q3, q4, q5 };
  });
  return { asOf: today, exportedAt: world.export.exported_at, accounts, refs };
}

const sev = (s) => ({ high: 3, medium: 2, low: 1 }[s] ?? 0);
const backingWhy = (evidence, strength) => {
  const c = { verified: 0, file: 0, told: 0, claim: 0 };
  evidence.forEach((id) => { const s = strength(id); if (s) c[s]++; });
  const parts = [];
  if (c.file + c.verified) parts.push(`${c.file + c.verified} verified/file`);
  if (c.told) parts.push(`${c.told} told`);
  if (c.claim) parts.push(`${c.claim} claim${c.claim > 1 ? "s" : ""} only`);
  return parts.length ? parts.join(", ") : "no evidence ids";
};

// ----- activity tables (any CSV with a month column): normalise names, dedupe, flag conflicts -----
function summariseActivity(file, accountName, cite) {
  const rows = file.rows;
  if (!rows?.length) return null;
  const cols = Object.keys(rows[0]);
  const monthCol = cols.find((c) => /month|period|date/i.test(c));
  const entityCol = cols[0];
  if (!monthCol || monthCol === entityCol) return null;
  const metric = ["live_missions", "patrol_flights"].find((m) => cols.includes(m)) ?? cols.find((c) => /live|patrol|mission/i.test(c) && !/test|train/i.test(c));
  if (!metric) return null;
  const installedCol = cols.find((c) => /install/i.test(c));
  const by = new Map(), quality = [];
  for (const r of rows) {
    const m = parseMonth(r[monthCol]); if (!m) continue;
    const key = entityKey(r[entityCol], accountName);
    const slot = by.get(key) ?? { label: r[entityCol], months: new Map() };
    const sig = JSON.stringify(Object.entries(r).filter(([k]) => k !== entityCol && k !== monthCol && k !== "notes"));
    if (slot.months.has(m)) {
      const prev = slot.months.get(m);
      if (prev.sig !== sig) quality.push({ text: `${r[entityCol]} ${m}: two rows disagree (${prev.row[metric]} vs ${r[metric]} ${metric})` });
      else slot.dupes = (slot.dupes ?? 0) + 1;
    } else slot.months.set(m, { row: r, sig });
    by.set(key, slot);
  }
  const monthsAll = [...new Set([...by.values()].flatMap((s) => [...s.months.keys()]))].sort();
  const last3 = monthsAll.slice(-3);
  const out = [...by.entries()].map(([key, s]) => {
    const series = last3.map((m) => { const v = s.months.get(m)?.row[metric]; return v == null || v === "" ? null : Number(v); });
    const installed = installedCol ? s.months.get(last3[last3.length - 1])?.row[installedCol] : null;
    const noDock = installedCol && /^(no|n|0)$/i.test(String(installed ?? "").trim());
    const active = series.filter((v) => v > 0).length >= 2 && series[series.length - 1] > 0;
    return { key, label: s.label, series, noDock: !!noDock, active, dupes: s.dupes ?? 0 };
  }).sort((x, y) => (x.key.startsWith("#") && y.key.startsWith("#") ? Number(x.key.slice(1)) - Number(y.key.slice(1)) : x.key.localeCompare(y.key)));
  const dupes = out.reduce((t, e) => t + e.dupes, 0);
  if (dupes) quality.push({ text: `${dupes} duplicate row(s) merged in ${file.title}` });
  return { file: cite(file.id), title: file.title, metric, months: last3, entities: out,
    activeCount: out.filter((e) => e.active).length, total: out.length, noDock: out.filter((e) => e.noDock).length, quality };
}

// ----- docks: which are flying (weekly usage), which are idle but online -----
function summariseDocks({ a, devices, usage, today, cites, n, cite, refs }) {
  if (!devices.length || !usage.length) return null;
  const weeks = [...new Set(usage.map((r) => r.week_start))].sort();
  const window = weeks.slice(-8);
  const byDock = {};
  for (const r of usage) if (window.includes(r.week_start)) byDock[r.dock_id] = (byDock[r.dock_id] ?? 0) + Number(r.flights || 0);
  const idle = devices.filter((d) => (byDock[d.dock_id] ?? 0) === 0 && d.last_seen_online && daysBetween(d.last_seen_online, today) <= 7);
  const flying = devices.filter((d) => (byDock[d.dock_id] ?? 0) > 0);
  const guard = (ids) => ids.filter((id) => refs[id]);
  return {
    windowWeeks: window.length, docks: devices.length,
    withFlights: n(flying.length, ...guard(flying.map((d) => `${a.id}:${d.dock_id}`)), `${a.id}:usage_weekly.csv`),
    caveat: "Counts any logged flight. The usage records do not say which are test flights, and no record says which plant a dock sits at.",
    idle: idle.map((d) => d.dock_id), idleCites: guard(idle.map((d) => `${a.id}:${d.dock_id}`)),
    perDock: devices.map((d) => ({ id: d.dock_id, flights: byDock[d.dock_id] ?? 0, lastSeen: d.last_seen_online, cite: cite(`${a.id}:${d.dock_id}`) })),
  };
}

function countDrops(events, today, days) {
  const out = {};
  for (const e of events) if (e.event === "connection_lost" && daysBetween(e.date, today) <= days) out[e.dock_id] = (out[e.dock_id] ?? 0) + 1;
  return out;
}

// ----- the index every citation resolves against -----
export function buildRefs(world) {
  const refs = {};
  const put = (id, type, account, title, body) => { refs[id] = { id, type, account, title, body }; };
  for (const a of world.export.accounts) {
    for (const s of a.stakeholders) put(s.id, "person", a.id, `${s.name}, ${s.role}`, `Relationship: ${s.relationship}. Available: ${s.available !== false}.`);
    for (const f of a.facts) put(f.id, "fact", a.id, `${f.said_by} (${f.status})`, f.text + (f.verified_by ? `\n[verified by file: ${f.verified_by}]` : ""));
    for (const o of a.opportunities) put(o.id, "deal", a.id, o.title, JSON.stringify(o, null, 2));
    for (const f of a.offers ?? []) put(f.id, "offer", a.id, f.title, JSON.stringify(f, null, 2));
    a.deadlines.forEach((d, i) => put(`${a.id}:deadline:${i}`, "deadline", a.id, "Deadline", JSON.stringify(d, null, 2)));
    const pw = world.paperwork[a.id] ?? {};
    for (const [path, rec] of Object.entries(pw)) put(`${a.id}:${path}`, "paperwork", a.id, path, rec.text ?? JSON.stringify(rec.json, null, 2));
    for (const t of pw["tickets.json"]?.json?.tickets ?? []) put(t.id, "ticket", a.id, t.subject, JSON.stringify(t, null, 2));
    for (const i of pw["invoices.json"]?.json?.invoices ?? []) put(i.number, "invoice", a.id, i.what, JSON.stringify(i, null, 2));
    for (const u of pw["users.json"]?.json?.users ?? []) put(`${a.id}:${u.user_id}`, "user", a.id, u.name ?? u.role, JSON.stringify(u, null, 2));
    for (const d of pw["devices.json"]?.json?.docks ?? []) put(`${a.id}:${d.dock_id}`, "dock", a.id, d.dock_id, JSON.stringify(d, null, 2));
    (pw["requests.csv"]?.rows ?? []).forEach((r, i) => put(`${a.id}:request:${r.request_id && r.request_id !== "(none)" ? r.request_id : i}`, "request", a.id, r.summary, JSON.stringify(r, null, 2)));
    (pw["internal_notes.json"]?.json?.notes ?? []).forEach((x, i) => put(`${a.id}:note:${i}`, "note", a.id, `${x.date} ${x.from}`, x.text));
  }
  for (const f of Object.values(world.files)) put(f.id, "file", f.account, f.title, f.text);
  for (const p of world.team) put(p.id, "flytbase", null, p.name, p.role);
  return refs;
}
