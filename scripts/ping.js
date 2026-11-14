// One call to prove the connection works: node scripts/ping.js
import "../src/env.js";
import { callToolNow } from "../src/mcp.js";
const out = await callToolNow("whoami");
console.log(JSON.stringify(out, null, 2));
