# Account CRM (Questathon)

A live CRM for two accounts (Eastern Counties Police Alliance, Aldermoor Industrial Group). It reads the game's MCP
and answers five questions per account. Every number carries a source id; click a chip to read the source.
There is no AI in the engine: it is plain rules (see `src/analyze.js`), so the same data gives the same answer.

## Run it
```
npm install        # nothing to install, no dependencies
cp .env.example .env   # put your token in AQ_TOKEN (never commit it)
npm start          # http://localhost:3000
```
Without a token it serves the committed snapshot in `data/raw/`. With one, it polls the MCP once a minute
(the game allows one call a minute per token), takes in new data without a code change, and writes the
first three moves back with `write_note`. Set `AQ_WRITE_NOTES=0` to stop writes.

`node scripts/pull.js` fetches everything once into `data/raw/`. The token only lives on the server (env var).

## Hosting
Any Node host: start command `npm start`, set env `AQ_TOKEN`. `PORT` is picked up automatically.
