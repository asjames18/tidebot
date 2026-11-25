# TideBot website

Static landing page for https://tidebot.melanatedintech.com — downloads, product info and open-source links. Plain HTML/CSS, no build step, no dependencies.

## Live hosting (Cloudflare Workers)

The live site is served by the `tidebot` Cloudflare Worker (static assets plus a small `/api/waitlist` endpoint for the managed-hosting waitlist). It is **not** on Vercel, and pushes to this repo do **not** auto-deploy it.

Deploy with Wrangler from the maintainer's deploy directory (which holds a copy of this folder plus the Worker entrypoint and waitlist KV binding):

```bash
wrangler deploy --config wrangler.jsonc
```

The waitlist form posts to `/api/waitlist`, which only exists on the Worker — the static page on its own does not collect signups. Keep this folder in sync with the live page whenever the landing page changes, including `favicon.png` and `screenshots/`.
