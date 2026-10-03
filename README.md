# Hours Tracker

A small, screen-reader-friendly website for logging worked hours (your own and those of people who help you) and viewing weekly/monthly reports per person.

Built for a user who relies on VoiceOver: large high-contrast UI, every control is a native element, and results are announced via ARIA live regions. The UI is in German by default; English and Ukrainian are available for testing with `?lang=en` or `?lang=uk` (remembered in the browser; `?lang=de` switches back). To add a language, add a dictionary to `public/i18n.js` and a locale to `public/parse.js`.

## Features
- Add an entry with one spoken/typed sentence, e.g. "Maria gestern eine Stunde zehn" (person, date, duration are parsed and confirmed before saving), or fill in the fields manually.
- Weekly and monthly reports per person, with navigation to previous periods.
- Manage the list of people.
- Sign in with Google (only whitelisted accounts); the browser stays signed in for a year.

## Stack
Plain Node.js (no dependencies), static frontend in `public/`, API in `lib/handler.js`.
Storage: a JSON file locally, Upstash Redis on Vercel.

## Run locally
```
node server.js
```
Open http://localhost:3000 (Google variables required for sign-in). Data lives in `data/data.json`.

## Google sign-in setup
1. In Google Cloud Console create a project, configure the OAuth consent screen, then create an OAuth client ID (type: Web application).
2. Add the authorized redirect URI `https://<your-domain>/api/auth/callback` (add `http://localhost:3000/api/auth/callback` for local use).
3. Set the environment variables below.

## Deploy to Vercel
1. Import the repository in Vercel (Framework preset: Other).
2. Add the Upstash Redis integration from the Vercel Marketplace (sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
3. Add the Google variables below.
4. Deploy (redeploy after changing variables).

## Environment variables
| Name | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client credentials |
| `ALLOWED_EMAILS` | Comma-separated list of Google accounts allowed to sign in |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis credentials (set by the integration) |
| `PORT`, `DATA_DIR` | Local server port and data folder |
