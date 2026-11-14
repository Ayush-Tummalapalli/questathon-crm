import { loadWorld } from "../src/world.js";
import { analyze } from "../src/analyze.js";
const out = analyze(loadWorld());
const brief = (x) => JSON.stringify(x, null, 1);
for (const a of out.accounts) {
  console.log("\n=========", a.id, a.name);
  console.log("TOTALS", Object.fromEntries(Object.entries(a.q1.totals).map(([k, v]) => [k, v?.value])));
  console.log("ACTIVITY", a.q1.activity.map((x) => `${x.title}: ${x.activeCount}/${x.total} active, ${x.noDock} no dock; quality=${x.quality.length}`));
  console.log("DOCKS", a.q1.usage && { docks: a.q1.usage.docks, withFlights: a.q1.usage.withFlights.value, idle: a.q1.usage.idle.length });
  console.log("MOVES", a.q3.moves.map((m) => `#${m.rank} ${m.title} due ${m.due} score ${Math.round(m.score)}`));
  console.log("RISKS", a.q4.risks.slice(0, 6).map((r) => `[${r.severity}] ${r.what} | ${r.when}`));
  console.log("UNKNOWN", a.q5.unknown.length, a.q5.unknown.slice(0, 4).map((u) => u.what.slice(0, 70)));
}
