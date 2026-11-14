// Generic helpers: CSV, dates, entity-name normalisation. No account-specific names anywhere.
export function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  const s = text.replace(/\r/g, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
// "May 2026", "Jun-26", "05/2026", "2026-05", "10/2026", "Sep 2026" -> "2026-05"
export function parseMonth(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/))) return `${m[1]}-${m[2].padStart(2, "0")}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) return `${m[2]}-${m[1].padStart(2, "0")}`;
  if ((m = s.match(/^([a-z]{3})[a-z]*[\s\-\/](\d{2}|\d{4})$/))) {
    const i = MONTHS.indexOf(m[1]); if (i < 0) return null;
    const y = m[2].length === 2 ? "20" + m[2] : m[2];
    return `${y}-${String(i + 1).padStart(2, "0")}`;
  }
  return null;
}

const NUMWORDS = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15 };
const GENERIC_STOP = new Set(["the","plant","site","police","constabulary","force","group","industrial","company","service","services","ltd","inc","alliance"]);

// Build a key that collapses "P01" / "Plant 1" / "Aldermoor Plant One", and
// "METRO CTRL" / "Metro Central Police". Digits win; otherwise the first meaningful word,
// where words from the account's own name are ignored.
export function entityKey(raw, accountName = "") {
  const own = new Set(accountName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const toks = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const mapped = toks.map((t) => (NUMWORDS[t] ? String(NUMWORDS[t]) : t));
  const digit = mapped.find((t) => /^\d+$/.test(t)) ?? (mapped.join(" ").match(/p0*(\d+)/)?.[1]);
  if (digit != null) return "#" + parseInt(digit, 10);
  const word = mapped.find((t) => t.length >= 3 && !GENERIC_STOP.has(t) && !own.has(t));
  return word ?? mapped.join("_");
}

export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000).toISOString().slice(0, 10);
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
export const eur = (n) => (n == null ? "—" : "€" + Math.round(n).toLocaleString("en-GB"));
