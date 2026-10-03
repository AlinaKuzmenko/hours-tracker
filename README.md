# Hours Tracker

A small, screen-reader-friendly website for logging worked hours (your own and those of people who help you) and viewing weekly/monthly reports per person.

Built for a user who relies on VoiceOver: large high-contrast UI, every control is a native element, and results are announced via ARIA live regions. The UI language is Ukrainian.

## Features
- Add an entry with one spoken/typed sentence, e.g. "Марія вчора година десять" (person, date, duration are parsed and confirmed before saving), or fill in the fields manually.
- Weekly and monthly reports per person, with navigation to previous periods.
- Manage the list of people.
- Login by a single secret phrase; the browser stays signed in for a year.

## Stack
Plain Node.js (no dependencies), static frontend in `public/`, API in `lib/handler.js`.
Storage: a JSON file locally, Upstash Redis on Vercel.

## Run locally
```
node server.js
```
Open http://localhost:3000. The login phrase is printed to the console (or set `PASSPHRASE`). Data lives in `data/data.json`.

## Deploy to Vercel
1. Import the repository in Vercel (Framework preset: Other).
2. Add the Upstash Redis integration from the Vercel Marketplace (sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. Add the environment variable `PASSPHRASE` with the secret login phrase.
4. Deploy.

## Environment variables
| Name | Purpose |
| --- | --- |
| `PASSPHRASE` | Secret login phrase (required on Vercel) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis credentials (set by the integration) |
| `PORT`, `DATA_DIR` | Local server port and data folder |
