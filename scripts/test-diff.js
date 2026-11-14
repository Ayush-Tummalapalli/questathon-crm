// Simulates the game sending new data and prints what the live feed would say. No network, no token.
import { recompute, _test } from "../src/live.js";
recompute();
const before = _test.digest();
const w = _test.getWorld();
const A = w.export.accounts[0];
A.facts.push({ id: "sim_fact_1", text: "Finance at Metro Central confirmed the budget is approved for 10 docks.", said_by: "Ewan Brooks", status: "verified" });
A.opportunities.find((o) => o.id === "a_renewal").blocker.status = "cleared";
A.opportunities.find((o) => o.id === "a_renewal").stage = "cleared";
w.paperwork.A["tickets.json"].json = { tickets: [] };
_test.reanalyze();
console.log(_test.diffDigest(before, _test.digest()).join("\n"));
