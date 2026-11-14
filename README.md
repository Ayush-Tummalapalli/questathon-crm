# Account CRM (Questathon)

A live CRM for two accounts: **Eastern Counties Police Alliance** (A) and **Aldermoor Industrial Group** (B).
It reads the game's MCP and answers five questions per account. **Every number carries the id of the record it
came from, and clicking the id opens that record.**

Live: https://ayush-questathon-crm.onrender.com/ (the free host can take about 30 seconds to wake up)

## The five answers

| # | Question | What the page shows |
|---|----------|---------------------|
| 1 | What is the book worth? | Each deal at a backed value. Money that cannot be backed is shown apart (hatched in the bar). Claims sit beside what the record verified. |
| 2 | Who holds the power? | Per deal: who decides, pays, uses and could block, and where each person stands. Roles guessed from a job title are marked "title only". |
| 3 | What do you do first? | The first three moves, ranked, each with an owner, a date and the deal it moves. Dates never pass the contract end. |
| 4 | What is about to go wrong? | Deadlines, people going cold, stuck deals and unused logins, with when each turns bad, on a timeline. |
| 5 | What do you still not know? | Gaps the plan rests on, why each matters (the deal it likely blocks), and who could fill it. |

A **Live activity** section at the bottom shows what the CRM has done since the server started: new data taken in,
how the answers changed, and the next-step notes written back to the game.

## How it decides

There is no AI in the CRM itself. It is plain rules, so the same data gives the same answer. See `src/analyze.js`.

- **Backing:** a deal is *backed* when verified facts or paperwork support it, *partial* when it rests on what
  someone told us, and *unbacked* when it rests on a claim alone. Unbacked money never enters the backed total.
- **Counting once:** signed recurring revenue plus closed expansion is the backed book. A renewal is shown as money
  at stake but is not added to the pipeline, because it is already inside recurring revenue.
- **First moves:** score = value at stake × urgency × 1.25 if a verified source is held. Urgency doubles when a
  deadline sits on the deal or the contract ends within 90 days. Dates are staggered and capped at the contract end.
  A deadline with no date on file is said so on the move.
- **Risks:** contract end, open tickets and requests (downgraded when an agreed deal already covers them), contacts
  silent for over 30 days, unused logins, unpaid invoices, idle docks and repeated connection drops.
- **Gaps:** taken from the account profile, unverified claims, open blockers and records that disagree. Links from
  a gap to a deal are keyword matches and say which words linked them. "Who could fill it" is guessed from job titles
  and says so.
- **Citation guard:** a number cannot be built without a source id (`n()` throws), and an id that does not exist
  throws (`cite()`). `npm run check` tests all of them.
- **Dirty data:** plant and force names are matched across spellings, six month formats are read, and duplicate or
  contradictory rows are merged and flagged.

## Run it

Needs Node 18 or newer. No packages to install.

```
cp .env.example .env     # put your game token in AQ_TOKEN (never commit it)
npm start                # http://localhost:3000
```

Without a token the server shows the committed snapshot in `data/raw/`. With a token it goes live (below).

| Variable | Purpose |
|----------|---------|
| `AQ_TOKEN` | Game token. Stays on the server and never reaches browser code. |
| `PORT` | Port to listen on (default 3000; hosts set it for you). |
| `AQ_WRITE_NOTES` | Set to `0` to stop writing notes back to the game. |

### Scripts

| Command | What it does |
|---------|--------------|
| `npm start` | Starts the server and the live loop. |
| `npm run pull` | Fetches everything once into `data/raw/` (one call a minute, resumable). |
| `npm run analyze` | Prints the five answers for both accounts in the terminal. |
| `npm run check` | Fails if any number cites a record that does not exist. |
| `npm test` | The citation check, plus a simulated change that prints what the live feed would say. |
| `npm run ping` | Calls `whoami` to check the token works. |

## How it stays live

`src/live.js` runs inside the server and makes about one call a minute (the game allows one call a minute per token,
writes included):

1. Every poll calls `get_signals`. Every fifth poll calls `get_my_accounts` and compares it, ignoring the export time.
2. If anything changed, it re-pulls the accounts, paperwork and files into `data/raw/`, re-runs the analysis and
   adds what changed to the live feed. **No code change is needed.**
3. When the ranked first moves change, it writes them back with `write_note` (kind `next_step`). Each note ends with
   a `[crm:<account>:<id>]` marker. After a restart it reads `list_notes` first, so notes already in the game are not repeated.

## Hosting

Any Node host works: build `npm install`, start `npm start`, set `AQ_TOKEN`. It is deployed on Render's free
tier. Render sleeps free services after 15 minutes without outside visits, so a free pinger (for example
UptimeRobot) can call `/health` every 5 minutes to keep the live loop running.

## Layout

```
server.js            static page, /api/crm, /api/status, /health
src/analyze.js       the five-question engine and the citation index
src/live.js          polling, change detection, live feed, write_note
src/mcp.js           MCP client with the one-call-a-minute queue and retry
src/world.js         loads data/raw into one object
src/util.js          name and month normalising, CSV, dates
public/index.html    the dashboard (one file, no build step)
data/raw/            snapshot the page starts from
scripts/             pull, analyze, check-citations, test-diff, ping
```

## Known limits

- The records cannot separate test flights from real patrols. Aldermoor shows 13 of 14 docks with flights but only
  4 of 15 plants flying regularly. The page says the two disagree.
- No record says which dock sits at which plant or force.
- Some roles and gap-to-deal links are guesses and are marked as such.
- Deal values are "up to" figures. Nothing is weighted by chance of closing.
- The page has no sign-in: anyone with the link can read it. The token is never exposed.
