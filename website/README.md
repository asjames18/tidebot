# TideBot website

Static landing page for https://tidebot.melanatedintech.com — downloads, product info and open-source links. Plain HTML/CSS, no build step, no dependencies.

## Deploying (Vercel)

1. In the Vercel dashboard, add a new project and point it at `asjames18/tidebot`.
2. Set the **Root Directory** to `website` (Settings → General → Root Directory). Vercel auto-detects it as a static site — no build command needed.
3. Deploy, then add the domain: Settings → Domains → add `tidebot.melanatedintech.com`. Vercel shows the DNS records to add at your registrar if the domain isn't on the same account yet.

Any push that changes `website/` redeploys automatically once the project is connected.
