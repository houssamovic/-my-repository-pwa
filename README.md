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

## Social video enrichment (v1.9)

Repository continues to save **the URL immediately**, even when a platform does not expose content to external services. It does **not** download videos, bypass login walls, access private posts, or claim to understand footage that has not been supplied.

### Better YouTube and YouTube Shorts titles/descriptions (optional)

You can provide an API key for the official **YouTube Data API v3**. This supplies the publisher's publicly available video title and description, often improving AI categorization compared with HTML previews and oEmbed.

1. Google Cloud Console: select/create a project; enable **YouTube Data API v3** from **APIs & Services → Library**.
2. Under **APIs & Services → Credentials**, create an API key. Restrict it to the **YouTube Data API v3** service. Keep it confidential, and review quota usage.
3. Cloudflare → **Workers & Pages → my-repository-pwa (Pages) → Settings → Variables and Secrets → Add**. Select **Production**, use the name **YOUTUBE_API_KEY**, paste the key, and choose **Encrypt**. Save and redeploy production after adding the secret.
4. In Repository, share a *new* public YouTube Short. For previously saved videos in **Unsorted**, use **Organize now** to re-fetch up to five previously opaque video links per click, or **Edit details → Refresh details** for any single link.

The key is only sent from the Cloudflare Pages Function to Google's API; it is **never embedded in the Android PWA or GitHub**. An error, inaccessible video, missing key, or exhausted quota falls back to public HTML metadata and YouTube oEmbed (title only). Successful YouTube API metadata is cached for six hours when Cloudflare's Cache API is available. Default daily API quotas apply. The public /api/metadata endpoint should be protected with Cloudflare rate limits before inviting many users.

### Instagram Reels and other inaccessible social videos

Instagram and Facebook's official oEmbed offering is intended for displaying embeds, **not extracting and storing captions or analyzing videos for unrelated purposes**. There is no general, dependable URL-only way to infer the visual/audio subject of any Reel.

Repository therefore captures any meaningful title or caption already included in Android's text Share payload. When a video lacks a description, the save screen offers a short optional **Description** clue, such as "Building a raised planter from recycled boards." Typing or editing this clue triggers fresh categorization without changing a manually selected category. The main editor now also preserves automatic-category eligibility when modifying descriptions. If there is no meaningful title/caption or user clue, Repository leaves the item in **Unsorted** rather than fabricating a description.

This remains **content classification from supplied text**, not audio transcription or automatic video watching. No API key or cloud login is needed to use Repository's existing local-first saving.

## Refresh missing YouTube descriptions (v1.10)

**Problem corrected:** YouTube videos could have been successfully categorized by title while remaining stuck with "Details unavailable from source". The previous **Organize now** tool appeared only in Unsorted, so it could not refresh links already placed in categories like News & Politics.

**New behaviour:** Open any category containing YouTube videos with missing descriptions and select **Refresh descriptions** beside the item count. Repository will retry up to 10 missing YouTube descriptions per click, at most two concurrently, keeping the current title, chosen category, notes and link intact. An optional safe diagnostic explains when the Cloudflare production YOUTUBE_API_KEY secret is missing, the Google request is denied, a video is inaccessible, or the video creator provided no description. Descriptions must be genuinely supplied by the source; Repository doesn't invent them.

The existing `/api/metadata?url=...` response format is unchanged. Appending `&diagnostic=1` returns an additional **sanitized** `diagnostic.youtubeApi` status, which never contains the key, upstream error text or user data. Possible values: `ok`, `cached`, `creator_description_empty`, `not_configured`, `rejected_or_quota`, `unauthorized`, `rate_limited`, `video_not_available`, `request_failed`, `not_youtube`. The creator-written YouTube description may legitimately be blank even with a working API key.

If the Pages secret was just added, redeploy Production. Keep the replacement key private and never paste it in chat or commit it to GitHub. The installed PWA update does not require reinstalling or restoring links.

## Saved-date browsing (v1.12)

Every new link saved through Android Share or the Repository form already records `created` as an ISO timestamp. Repository now displays its **Saved** date in each link row and offers a compact date filter under Search in both the full collection and every category.

**Date choices:** Any date, Today, Yesterday, Last 7 days, Last 30 days, Specific date, and Date range (inclusive From/To). Text search, selected category, and date filtering work together. Choosing a date on the homepage shows matching links across **all categories**; choosing one within a category only searches that category. Clear date restores the usual tiles or category list without deleting saved links. Relative periods use the **device's local calendar dates**, including daylight-saving boundaries, not UTC midnight.

Existing links with valid `created` timestamps are automatically filterable. Imported older links with no valid timestamp are shown as **Date unavailable**, not assigned a fabricated import date. Their other data is preserved. Existing JSON and encrypted cloud backups remain version 1 compatible. This is a client-side interface change: no new database, login, permissions or external API fees. The PWA's manifest `id` and Android Share Target are unchanged, and reinstalling is unnecessary.

**Regression tests:** `node --test tests/*.test.mjs` covers calendar boundaries, presets, inclusive date ranges, invalid and missing dates, and the UI integration.

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
