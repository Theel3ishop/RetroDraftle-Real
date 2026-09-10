# Retro Draftle

## Cloudflare Pages deployment

This is a Cloudflare **Pages** project using a root-level `_worker.js` entry point. The project intentionally has no application folders.

### Git-connected deployment

Connect this GitHub repository directly to Cloudflare Pages. Cloudflare performs the deployment itself, so this setup does not require a Wrangler deploy command, API token, `package.json`, or build dependencies.

In Cloudflare, create a **Pages** project, not a Workers Builds project, and use:

- Framework preset: `None`
- Build command: leave blank
- Build output directory: `.`
- Root directory: `/`
- Deploy command: leave blank. If Cloudflare requires a deploy command, this is the wrong project type; create a Pages project through **Workers & Pages → Create application → Pages → Connect to Git**.

After deployment, the data endpoint will be available at `/api/nflverse?year=2009`.

### Local testing

Use the included proxy-aware development server:

```powershell
python dev-server.py
```

Do not use `python -m http.server`, because it cannot run the local data proxy.