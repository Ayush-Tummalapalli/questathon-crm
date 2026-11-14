import "./env.js";
// Server-side MCP client. The token lives in AQ_TOKEN (env), never in browser code or git.
// Each token gets ONE call a minute (writes included), so every call goes through one queue.
const MCP = process.env.AQ_MCP_URL || "https://questathon.aihackerscollective.com/api/public/mcp";
const GAP_MS = 62_000; // one call a minute, with a little margin

let last = 0;
let chain = Promise.resolve();

async function rawCall(name, args = {}) {
  const token = process.env.AQ_TOKEN;
  if (!token) throw new Error("AQ_TOKEN is not set (put it in .env or the host's environment)");
  const res = await fetch(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { // some servers answer as an event stream: take the last data: line
    const line = text.split("\n").filter((l) => l.startsWith("data:")).pop();
    body = JSON.parse(line.slice(5));
  }
  const { result, error } = body;
  if (error || result?.isError) throw new Error(error?.message ?? result.content?.[0]?.text ?? "MCP error");
  const t = result.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return t; }
}

// Rate-limited: calls run one at a time, at least GAP_MS apart.
export function callTool(name, args = {}) {
  const run = async () => {
    const wait = Math.max(0, last + GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    for (let attempt = 0; ; attempt++) {
      try { return await rawCall(name, args); }
      catch (e) {
        const m = String(e.message).match(/retry_after_seconds"?\s*:\s*(\d+)/);
        if (m && attempt < 5) { // server says too soon: wait exactly as long as it asks, then retry
          await new Promise((r) => setTimeout(r, (Number(m[1]) + 2) * 1000));
          continue;
        }
        throw e;
      } finally { last = Date.now(); }
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

// For one-off scripts where the first call should not wait.
export async function callToolNow(name, args = {}) {
  last = Date.now();
  return rawCall(name, args);
}
