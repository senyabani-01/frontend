# Deploying the frontend to Azure (Node / pm2 approach)

Your setup changed since last time — no more `nginx.conf`, and
`package.json` now has a `pm2 serve` start script plus a `startup.txt`.
That means: no Docker, no reverse proxy. Azure runs this as a plain Node
app, and pm2 serves the built `dist/` folder directly. The frontend talks
to your FastAPI backend **cross-origin**, using an absolute URL baked in
at build time.

## What I actually changed, and why

I ran a real `npm ci` + `vite build` + `pm2 serve` against your uploaded
files to check they'd actually work on Azure, and found two things that
would have broken the deploy:

1. **`package-lock.json` was out of sync.** You added `"pm2"` to
   `package.json`'s dependencies, but the lockfile was never regenerated
   to include it. `npm ci` — which is what CI/Azure use for reproducible
   installs — refuses to run when the two don't match, so the very first
   build step would have failed outright. I regenerated it (still
   `lockfileVersion: 3`, everything else untouched) and confirmed `npm ci`
   installs cleanly from it.

2. **The `pm2 serve` command had the wrong arguments**, in both
   `package.json`'s `start` script and `startup.txt`:
   ```
   pm2 serve dist dist --no-daemon --spa
   ```
   `pm2 serve`'s syntax is `pm2 serve <path> <port> [options]` — the
   *second* argument is the port, not another path. `"dist"` isn't a
   valid port number, so pm2 was silently falling back to its own
   default (port 8080) instead of listening on the port you actually
   meant to specify. It happened to still work locally by accident, but
   it's exactly the kind of thing that fails unpredictably once it's
   Azure setting the port instead of pm2's fallback. I fixed both to
   explicitly serve on port 8080 (Azure's default expected port for the
   built-in Linux Node runtime) and confirmed with a live test that it
   serves `index.html` (200 OK) and falls back to it correctly for
   client-side routes like `/admin`.

Nothing else — no component, no endpoint, no route — was touched.

## Files to update in your repo

```
your-repo/
├── package.json         # UPDATED — fixed start script only
├── package-lock.json     # UPDATED — now includes pm2
├── startup.txt            # UPDATED — fixed port argument
├── .github/workflows/deploy-azure.yml   # NEW
└── ... (everything else unchanged)
```

If you still have the `Dockerfile` / `nginx.conf` / `.dockerignore` from
before in your repo, you can delete them — they're not used by this
approach.

## 1. Create the Azure Web App (one-time, in the Azure Portal)

1. **Create a resource → Web App**.
2. **Publish**: Code (not Docker Container). **Runtime stack**: Node 22 LTS.
   **Operating System**: Linux.
3. Any tier works, including the Free (F1) tier — code-based Node apps
   don't have the custom-container restriction Docker deploys do.
4. Once created, go to **Deployment Center → Manage publish profile →
   Download publish profile**.

## 2. Set the Startup Command

On the Web App → **Configuration → General settings → Startup Command**,
paste the contents of `startup.txt`:

```
pm2 serve /home/site/wwwroot/dist 8080 --no-daemon --spa
```

This is what tells Azure how to actually run your app — without it, Azure
tries to guess a Node entry point and won't find one, since this repo
has no `server.js`.

## 3. Turn off Azure's own build step

Since GitHub Actions already runs `npm ci` and `npm run build` and
uploads the finished `node_modules` + `dist`, tell Azure not to rebuild
on top of that (which would also strip out the `VITE_API_BASE_URL` you
set only in CI). Add this **Application setting**:

| Name                            | Value   |
|----------------------------------|---------|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` |

## 4. Add GitHub secrets

Repo → **Settings → Secrets and variables → Actions**, add:

- `AZURE_WEBAPP_PUBLISH_PROFILE` — the full contents of the publish
  profile from step 1.
- `VITE_API_BASE_URL` — your backend's root URL, e.g.
  `https://your-backend-app-name.azurewebsites.net` (no trailing `/api`
  — matches the value already in your gitignored `.env.production`, just
  moved somewhere CI can actually read it, since `.env.production` never
  reaches GitHub).

## 5. Edit one line in the workflow

Open `.github/workflows/deploy-azure.yml` and set:

```yaml
AZURE_WEBAPP_NAME: your-actual-app-name
```

## 6. Enable CORS on your backend

This is the one piece outside the frontend: because there's no more
nginx proxy sitting in front, the browser now calls your FastAPI backend
directly, cross-origin. Your backend needs `CORSMiddleware` (or
equivalent) configured to allow requests from your frontend's Azure
domain, or every API call will fail in the browser with a CORS error even
though the deploy itself succeeded. I haven't touched your backend, so
this is worth checking on that side.

## 7. Push to `main`

Pushing to `main` (or running the workflow manually from the Actions tab)
now builds, uploads, and deploys. Once it finishes, your Azure domain
(`your-app-name.azurewebsites.net`) should serve the app directly.
