# League Study Data Collector

Private Cloudflare Worker endpoint for the League Decision Study.

## What It Does

- Accepts `POST` requests only from `https://nathankurosky.com`.
- Stores each autosave/final submission as a private JSON value in Cloudflare KV.
- Exposes no read/list endpoint, so participants and website visitors cannot retrieve submitted data.
- Keeps Cloudflare credentials and storage access entirely server-side.

## One-Time Cloudflare Setup

Run these from this folder after logging in:

```powershell
npx wrangler login
npx wrangler kv namespace create league_study_data
npx wrangler deploy
```

The deploy command prints a Worker URL like:

```text
https://league-study-data-collector.<your-subdomain>.workers.dev
```

Put that URL into `studies/league-decision-task/index.html`:

```js
remoteAutosaveUrl: 'https://league-study-data-collector.<your-subdomain>.workers.dev',
remoteAutosaveMode: 'cors',
remoteAutosaveToken: '',
downloadResultsWhenRemoteSaveWorks: false
```

Then commit and push the website config change.

## Reviewing Data

Use the Cloudflare dashboard:

1. Workers & Pages > KV.
2. Open the `league_study_data` namespace.
3. Search keys by `league-decision-task/<participant_id>/`.
4. Open or download the latest JSON value or final submission.

Each object contains the full `decision_tsv` plus the structured rows.
