# Repository · Cloudflare Pages PWA

Minimalist link repository with Android Share Target, editable share receipt, direct source opening, topic classification and optional **end-to-end encrypted cloud backup**.

Production URL: <https://my-repository-pwa.pages.dev/>. GitHub source: `houssamovic/-my-repository-pwa`.

## Metadata enrichment update (November 2026)

- The Pages Function \`/api/metadata\` now reads Open Graph/Twitter fields and public schema.org JSON-LD for articles, how-tos, recipes and videos.
- Generic social login metadata is ignored rather than used as a misleading description.
- Public YouTube oEmbed supplies a **best-effort title fallback** when YouTube page HTML is inaccessible; it cannot reveal transcripts or reliably provide descriptions.
- Restricted Instagram, X and Facebook content still requires user-supplied details if metadata is unavailable. Do not use Meta's embedding API as a general content extraction service.
- No client-side PWA code, manifest ID, Android share target, local storage or cloud vault credentials changed. No reinstall necessary. Existing entries can be rechecked using **Edit details → Refresh details**.
- Tests: \`node --test tests/*.test.mjs\`.

## Optional semantic AI categorization

**Why:** Metadata extraction alone does not understand a video. Previous rule-based classification only matched hard-coded phrases, so many links were still placed in Unsorted even when their titles were readable.

**Activation:**
1. Cloudflare Dashboard → Workers & Pages → **my-repository-pwa (Pages)** → **Settings → Bindings** → **Add → Workers AI**.
2. Set the binding name to **AI** and save it for **Production**.
3. Redeploy the latest production commit so the binding is available.
4. Close/reopen the installed Repository PWA (no uninstall), and reopen the homepage to recheck up to three existing Unsorted items per session.
5. Share a public YouTube video with a readable title. The share receipt can say "Categorization pending": processing may finish once Repository is next opened if Android closed the sharing window.

When the **AI** binding is absent, no AI inference happens and classification falls back to existing rules. Only public title and description are sent for classification, not link URLs, notes, other saved items, or backup codes. The /api/classify endpoint is currently unauthenticated and can be abused; add Cloudflare WAF/rate limiting and monitor the Workers AI quota **before public launch**. The free tier has a finite inference allowance. A model does not have access to the content of videos: if no trustworthy title or description can be retrieved, links remain Unsorted rather than being guessed at. Manually chosen categories are never automatically overwritten.

**Testing:** run node --test tests/*.test.mjs. Tests cover label validation and safe fallback but actual Cloudflare Workers AI output still requires live verification.

## Current scope

- Android installed PWA appears in Share menu. Share URLs, optionally edit title, description, category or note, and return with Android Back.
- Links are always saved **locally first** in browser storage. Keep exporting JSON backups if cloud backup is not enabled.
- Public webpage title/description extracted through `/api/metadata`. Some Instagram/X/Facebook items expose no usable content to third parties. No caption or video understanding is invented.
- Deterministic topic classifier (`site/classifier.js`) considers genuine title, description and human-readable URL path, and creates new category tiles only on confident matches. User-chosen categories remain authoritative. No AI API fees.
- Optional encrypted backup (`/api/vault/...`): AES-GCM in browser, randomly generated secret recovery code, hash-only authorization token in database, conflict detection; while connected and online, snapshots auto-upload after saving. This is **not live multi-device synchronization**. A second device must explicitly **Restore from code**, and concurrent changes can trigger a conflict instead of silently overwriting. Keep the code secure: there is no password reset.

## Deployment

The repository is connected to Cloudflare Pages with framework None and output directory `site`, with `/functions` alongside `/site`. New GitHub commits deploy automatically. Keep `site/manifest.webmanifest` `id`, `start_url`, `scope`, and `share_target` stable so PWA upgrades don't need reinstall.

Cloud storage is **disabled safely** until configured in Cloudflare. To enable:

1. Cloudflare Dashboard → **Storage & databases → D1 SQL Database** → Create database named `repository-backups` (Free plan where eligible).
2. Open the new database's **Console** and execute the SQL from [`database/schema.sql`](database/schema.sql). No credentials or personal saved links go in GitHub.
3. Cloudflare → **Workers & Pages → your Pages project → Settings → Bindings → Add → D1 database**. Binding variable name: **`REPOSITORY_DB`**, select database `repository-backups`. Set production (and preview separately only if needed).
4. **Redeploy** the most recent Git commit in Cloudflare Pages. Confirm `/api/vault/status` shows `{"available":true}`. If false, check the binding and schema.
5. Open Repository → **Cloud backup** → **Create backup**. Save the one-time recovery code in a secure password manager. No source links or decryption key are stored unencrypted in Cloudflare's database.
6. On another device: install/open the same Pages URL, Cloud backup → paste code → Restore. Export existing links before accepting replacement of local data.

**Security and operations:** This is a personal MVP, not a production-ready multi-user service. Cloud vault creation is publicly accessible if D1 is enabled. Before promoting it publicly, add Cloudflare WAF/rate limiting/Turnstile to protect accountless vault creation from abuse, monitor D1 quotas, and adopt a production identity system if user accounts, reset/recovery, and reliable multi-device merges are required. No secrets should be committed to the repository. The backup recovery code is the only way to decrypt an accountless vault; possession grants access. Auto-backup is best effort while the app is open and online, not guaranteed when Android suspends the share activity. Use local Export backups periodically.

## Testing

Run `node --test tests/*.test.mjs` (Node 20+). Tests cover metadata extraction, classification accuracy safeguards, bearer authorization, optimistic concurrency, encryption and recovery.

## File layout

- `site/`: static PWA and browser-only encryption, category classification, local storage
- `functions/api/metadata.js`: best-effort public page metadata (bounded fetch, SSRF checks)
- `functions/api/vault/`: encrypted backup API, Cloudflare Pages Functions
- `database/schema.sql`: D1 schema
- `site/_routes.json`: only `/api/*` invokes Pages Functions
- `tests/`: local test suite
