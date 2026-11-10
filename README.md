# Repository: Cloudflare Pages edition

Minimal installed web app for saving shared links from Android. Migrated from Repository v1.5. Same screens and PWA share-target, with a Cloudflare Pages Function for public-page metadata.

## Deployment (GitHub → Cloudflare Pages)

1. Create a **new empty GitHub repository**, preferably private, such as `my-repository-pwa`.
2. Upload **the contents of this project's root** to the GitHub repository. `site/` and `functions/` must be alongside each other at the root.
3. In Cloudflare, navigate to **Workers & Pages → Create application → Pages → Connect to Git** (or Pages → Import existing Git repository if displayed). Authorize GitHub, select your new repository, and choose the production branch `main`.
4. Build configuration: **Framework: None**, **Build command: `exit 0`**, **Build output directory: `site`**. Do not specify `functions` as the build directory.
5. Deploy. Confirm the deployed `https://<project>.pages.dev/` page loads. Test `/check.html` and `/api/metadata?url=https%3A%2F%2Fwww.wikipedia.org%2F` (the latter may vary by source access).
6. Export all saved links on your installed Netlify Repository first. Install the new Cloudflare URL as a separate PWA from Chrome and import your backup. The new domain has separate local storage.
7. Test Android Share → Repository and open/edit saved links **before** considering removal of the Netlify site.

**Important:** Choose **Connect to Git**, not **Direct Upload**. Cloudflare currently does not allow upgrading a Direct Upload Pages project to Git integration later.

## Architecture

- `site/`: website and Android PWA files (v1.5 user experience)
- `site/_routes.json`: invokes Cloudflare Functions only on `/api/*`, keeping ordinary static requests outside the Functions allowance
- `functions/api/metadata.js`: server-side best-effort metadata extraction from public HTML; no AI, no private social login, no guaranteed Instagram/X content access
- `site/app.js` and `site/share-receiver.js`: metadata endpoint updated from Netlify to `/api/metadata`
- Local storage keys, app manifest identity and share destination unchanged relative to v1.5 (on a **new origin**, separate installation is unavoidable)

## Updating

Push changes to `main` to trigger Cloudflare production deployment. Use another Git branch for previews. Keep the PWA manifest identity and `share_target.action` stable to avoid Android app registration changes. The service worker checks for updated versions at launches. A visible update banner has **not** yet been implemented.

## Data protection

Links are **still saved in browser local storage on each device**, not in Cloudflare D1. Do not uninstall the old PWA before exporting a backup. The website is public, but local saved links are not published to a shared database. Later cloud synchronization would require account authentication, private data isolation, and a migration strategy, not just a D1 table.

## Known limitations

- Some social networks block metadata extraction. URL capture still works, but automatic descriptions may be incomplete.
- An installed PWA opens its receiving page when selected from Android's share sheet; browsers do not guarantee automatic return to the previous app.
- Server-side metadata previews are best-effort and subject to rate limits or content restrictions.
