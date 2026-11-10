# Repository — Android PWA

A minimal, text-first link repository with Android share-sheet capture, categories, searchable saved items, editable titles/descriptions and source links.

## Migration to Cloudflare Pages

The working Cloudflare migration package was prepared separately and must be imported in full before deployment. **This repository is not deployment-ready until the `site/` and `functions/` directories are committed.**

### Deploy configuration

- Provider: Cloudflare Pages
- Git branch: `main`
- Framework preset: None
- Build command: `exit 0`
- Output directory: `site`
- Server function: `functions/api/metadata.js`

Cloudflare Pages should be connected using **Git integration** rather than Direct Upload. Keep `site/` and `functions/` side by side in the repository root.

## Android PWA migration

Before switching from Netlify, export saved items from the existing installation. The new Cloudflare URL has a different browser storage origin. Install the new website from Chrome and import your backup. Verify Android share-target capture, source-link opening, and editing before retiring the old site.

The app currently stores bookmarks in **browser local storage**, not a shared cloud database. Public source code must never contain user saved links, passwords or API credentials.

## Remaining work

1. Commit the migration source files into this repository.
2. Connect the repository to Cloudflare Pages.
3. Deploy and verify HTTPS, manifest, service worker and metadata route.
4. Import existing backup and test Android share integration.
5. Add authenticated cloud sync and better classification in a future phase.
