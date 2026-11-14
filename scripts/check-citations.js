// Checks that every number and piece of evidence in the output cites a record that exists.
// node scripts/check-citations.js   (exit code 1 on any invented id)
import { loadWorld } from "../src/world.js";
import { analyze } from "../src/analyze.js";

const r = analyze(loadWorld(), new Date());
const bad = new Set(), empty = [];
let total = 0;
const walk = (o, path) => {
  if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
  if (!o || typeof o !== "object") return;
  if ("value" in o && "cites" in o) {
    total++; if (!o.cites.length) empty.push(path);
    o.cites.forEach((c) => { if (!r.refs[c]) bad.add(c); });
    return;
  }
  for (const k of Object.keys(o)) {
    if (k === "cites" && Array.isArray(o[k])) { total++; if (!o[k].length) empty.push(path); o[k].forEach((c) => { if (!r.refs[c]) bad.add(c); }); }
    else if (k === "evidence" && Array.isArray(o[k])) o[k].forEach((e) => { total++; const id = e.id ?? e; if (!r.refs[id]) bad.add(id); });
    else walk(o[k], `${path}.${k}`);
  }
};
walk(r.accounts, "accounts");
console.log(`cited items: ${total}, sources indexed: ${Object.keys(r.refs).length}`);
console.log("ids that do not exist:", [...bad].length ? [...bad] : "none");
console.log("items with no citation (allowed only for the unverified official story):", empty);
const allowed = (p) => /\.q1\.story$/.test(p);
if (bad.size || empty.some((p) => !allowed(p))) { console.error("FAILED"); process.exit(1); }
console.log("OK");
