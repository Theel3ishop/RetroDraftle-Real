# Retro Draftle

## Cloudflare Pages deployment

This is a Cloudflare **Pages** project using a root-level `_worker.js` entry point. The project intentionally has no application folders.

### Dashboard deployment

In Cloudflare, create or edit the Pages project connected to this repository and use:

- Framework preset: `None`
- Build command: leave blank
- Build output directory: `.`
- Root directory: `/`
- Deploy command: `npx wrangler pages deploy . --project-name retro-draftle`

Do not set the deploy command to `npx wrangler deploy`. That command is for Workers and causes the `Missing entry-point to Worker script or to assets directory` error.

If the Cloudflare project requires a **Deploy command** field, use the Pages command above exactly.

### Command-line deployment

From this project directory, use the Pages command:

```powershell
npx wrangler pages deploy . --project-name retro-draftle
```

The first deployment may ask you to authenticate with Cloudflare. The data endpoint will be available at `/api/nflverse?year=2009` after deployment.

### Local testing

Use the included proxy-aware development server:

```powershell
python dev-server.py
```

Do not use `python -m http.server`, because it cannot run the local data proxy.