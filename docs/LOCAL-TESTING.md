# Local Testing Mode

This project now includes a stable local testing flow that does not depend on Cloudflare remote preview.

## What it gives you

- A local D1 database with full table structure
- A default admin account for login
- A sample project, product categories, prices, accounts, and booths
- A repeatable reset command for starting over

## One-time setup

```bash
npm run db:init:local
```

This command will reset the local D1 database and load test data.

## Start local testing

```bash
npm run dev -- --port 8788
```

Then open:

```text
http://127.0.0.1:8788
```

## Local login account

- Username: `admin`
- Password: `123456`

Optional staff account:

- Username: `sales01`
- Password: `123456`

## When to run reset again

Run `npm run db:init:local` again when:

- you want to clear local test data
- you want to test from a clean state
- local tables were changed and need to be rebuilt

## Recommended workflow

1. Tell Codex the full batch of changes.
2. Codex updates code locally.
3. Run `npm run db:init:local` if needed.
4. Run `npm run dev -- --port 8788`.
5. Test in the browser locally.
6. After approval, push to GitHub for Cloudflare deployment.
