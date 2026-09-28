# Book Scanner PWA

A multi-user, friends-only phone app (installed to the home screen as a PWA) that recognises books from photos, fetches as much metadata as possible, lets users correct it, and detects duplicates. Hosted on Cloudflare. Built and maintained with Claude Code.

## Locked decisions

- **Platform:** PWA, installed to home screen. No native app.
- **Hosting/stack:** Cloudflare Workers (API), D1 (data), R2 (covers only), React front end. Worker framework: Hono.
- **Users:** multi-user. Each user has their own library. Access is friends-only (allowlist) until the owner decides to go public.
- **Photos:** discarded after recognition. Never stored. Only cover images/thumbnails are kept.
- **AI vision:** Claude API. Barcode first (no AI cost), then a small Claude model for spine/cover/back, escalate to a larger model on low confidence.
  - Default: `claude-haiku-4-5-20251001`. Escalation: `claude-sonnet-5-5`.
  - The API key lives in a Worker secret. It never reaches the client.
- **Data model:** three levels: Work -> Edition -> Copy, with a shared catalog and per-user overrides.
- **Free tier first:** design to stay inside Cloudflare free limits. See "Platform constraints".

## Features (all in scope)

1. Camera scan: recognise books from spine, cover, or back cover, plus barcode/ISBN.
2. Upload a photo and recognise books from it (spine, cover, back). Supports many books in one photo (shelf photos).
3. For each book, gather as many details as possible (see "Metadata").
4. Manual editing of any detail, with locked fields.
5. Manual add: type partial info (title/author/ISBN), get ranked candidate matches, pick one or save fully manual.
6. Duplicate detection (see "Duplicates").
7. Library features: search, filter, sort, tags/shelves/locations, read status, rating, notes, wishlist vs owned, "lent to".
8. Batch scan mode: scan many books in a row without leaving the camera.
9. Import/export: CSV export (backup) and Goodreads CSV import.
10. Offline: queue scans when signal is poor, sync later.
11. Custom cover upload when the found cover is missing or wrong.
12. Re-match button on any book to search again and swap the match.

## Auth and access

- Friends-only via an allowlist of email addresses (owner-managed).
- **Do not hash passwords inside a free Worker** (10 ms CPU limit; proper password hashing costs far more). Use one of:
  - Cloudflare Access with an email allowlist (verify free-tier user limits), or
  - Google/GitHub sign-in with an email allowlist enforced in the Worker.
- Test login from an **installed home-screen PWA on iOS**, not just Safari. Standalone mode can break cookie-based auth flows.
- Going public later = loosening the allowlist, not re-architecting. Keep the allowlist check in one place.
- Every query is scoped by `user_id`. No endpoint may return another user's copies.
- **Per-user daily scan quota** (configurable, default e.g. 50 AI recognitions/day) so one user cannot run up the API bill. Barcode scans that hit only free metadata APIs don't count.

## Recognition pipeline

Order of attempts, cheapest first:

1. **Barcode/ISBN** (back cover). Decode client-side with a JS/WASM library (e.g. zxing). iOS Safari has no native `BarcodeDetector`. If an ISBN is found, skip vision entirely and go to metadata lookup.
2. **Vision model** for spine/cover/back when no barcode is found. Prompt it to return **JSON only**: a list of detected books, each with `title`, `author` (if visible), `isbn` (if visible), `publisher` (if visible), `position` (for shelf photos), and `confidence` (0-1).
3. **Metadata lookup** per detected book (see below), then match scoring.

Rules:

- **Always return a list.** A photo may contain 1 to 40 books. Never assume one book per image.
- **Resize and compress on the client** before upload (long edge about 1568 px). Free Workers have tight CPU limits and images cost tokens.
- **One lookup request per book, sent by the client.** Free Workers allow ~50 subrequests per request, so a 30-book shelf cannot do all lookups in one Worker invocation.
- Waiting on the vision API is network time, not CPU time. Keep Worker CPU work minimal anyway.
- Validate and safely parse model JSON (strip code fences, handle malformed output, retry once).
- Rate-limit and quota-check before calling the vision API.

### Confidence and review flow

- **High confidence:** auto-add to library (still show in an "recently added" undo list).
- **Medium confidence:** show 2-4 candidate matches for the user to pick from.
- **Low confidence / no match:** goes to a "Needs review" inbox where the user can edit manually, re-match, or discard.
- Thresholds live in one config file so they can be tuned against the test photo set.

## Metadata

**Sources** (priority order, confirm during build and adjust): Open Library, Google Books, Hardcover. Merge strategy: take the highest-priority non-empty value per field, fill blanks from lower-priority sources.

**Fields to target:** title, subtitle, authors, ISBN-10/13, publisher, publish date, edition/format, page count, language, description, subjects/genres, series name and number, cover image, ratings.

**Provenance:** store which source supplied each field (and when), so wrong data can be traced.

**Caching:** cache lookups in the shared catalog so repeated lookups (and friends scanning the same book) cost no new API calls. Respect each API's rate limits and terms.

**Locked fields:** once a user manually edits a field, a later "refresh metadata" or re-match must not overwrite it.

**Covers:** store a small thumbnail in R2 (or hotlink where terms allow). User-uploaded custom covers go in R2, per user.

## Data model

Shared catalog (same for all users):

- `works` (id, normalised_title, normalised_primary_author, ...)
- `editions` (id, work_id, isbn13, isbn10, title, subtitle, authors, publisher, publish_date, format, page_count, language, description, subjects, series_name, series_number, cover_key, field_provenance JSON, fetched_at)

Per user:

- `users` (id, email, display_name, created_at)
- `copies` (id, user_id, edition_id, quantity, status [owned/wishlist], read_status, rating, notes, location/shelf, lent_to, lent_at, added_at)
- `copy_overrides` (copy_id, field, value, locked) for user edits and locked fields. **User edits never modify the shared catalog.**
- `tags` and `copy_tags`
- `custom_covers` (copy_id, r2_key)
- `scan_usage` (user_id, date, count) for quotas
- `review_queue` (id, user_id, detected JSON, candidates JSON, confidence, created_at)

Fully manual books (no match found) create a private edition row owned by that user rather than polluting the shared catalog.

**Indexing is mandatory.** D1 counts rows *scanned*, not rows returned. Index at least: `editions.isbn13`, `editions.isbn10`, `works.normalised_title + normalised_primary_author`, `copies.user_id`, `copies.edition_id`, and any column used in library filters/sorts. Never run full-table scans for duplicate detection.

## Duplicates

- **Exact duplicate:** same edition (same ISBN) already in this user's library. Warn at add time. Offer: increase quantity, add anyway, or cancel.
- **Fuzzy duplicate:** normalised title + author match (handle "The Hobbit" vs "Hobbit, The", punctuation, case, subtitles). Warn at add time.
- **Same work, different edition:** soft flag ("you own another edition"), not an error.
- **Intentional multiple copies:** supported via `quantity`.
- **Merge tool** for existing duplicates in a library.
- Two different users owning the same edition is normal and never flagged.
- Duplicate checks use indexed normalised keys, not table scans.

## Platform constraints (verify against Cloudflare docs before relying on them)

Approximate free-tier numbers at time of writing:

- **Workers:** 100K requests/day; 10 ms CPU per invocation (some sources say 30 ms, so check); ~50 subrequests per request.
- **D1:** 5M rows read/day, 100K rows written/day, 5 GB storage. Since 1 Sept 2026, queries **fail** once the daily row limits are exceeded (no graceful degradation). Add basic handling and a friendly error.
- **R2:** 10 GB storage, 1M writes/month, 10M reads/month, no egress fees.
- Design so that hitting a limit produces a clear message, not a broken app.
- If the free tier proves too tight, the $5/month Workers Paid plan is the fallback. Note it, don't silently assume it.

## PWA requirements

- Web app manifest, service worker, installable on iOS and Android.
- Camera via `getUserMedia`; test on a real iPhone in standalone mode.
- Offline: cache the app shell and library for reading. Queue scans/edits locally and sync when online. Handle conflicts with last-write-wins per field, except locked fields.
- Mobile-first UI: large tap targets, one-handed batch scan mode.

## Privacy

- Uploaded/scanned photos are processed in memory and discarded. Do not write them to R2, D1, logs, or analytics.
- Do not log full vision responses containing user data beyond what is needed for debugging, and never log API keys.
- Each user's library is private to them. Friends-only refers to who can sign up, not to shared libraries. (Optional later: opt-in sharing/lending features.)

## Build phases

1. **Foundation:** auth + allowlist, D1 schema, library CRUD, manual edit with locked fields, barcode scan + ISBN metadata lookup with caching and provenance, PWA shell.
2. **Vision, single book:** cover and back-cover recognition, confidence flow, review inbox, re-match, manual add with candidate search, custom cover upload.
3. **Vision, upload and shelves:** photo upload, multi-book spine recognition, batch scan mode, per-user quotas.
4. **Duplicates and polish:** duplicate detection and merge tool, library features (tags, shelves, lent-to, wishlist), CSV export, Goodreads import, offline queue and sync.

Finish and test each phase before starting the next.

## Testing and acceptance

Build a test set in `/test-photos/` (15-20 images) before phase 2:

- Clear spines, spines in poor lighting, angled spines
- Front covers, back covers with barcodes
- A full shelf photo (20+ books)
- An obscure book, a non-English book, a book with no ISBN

Success criteria (owner to confirm/adjust):

- ISBN barcode scan: identifies the correct edition in >= 95% of clear barcodes.
- Clear spines: >= 80% correctly identified.
- Shelf photo: detects >= 70% of books with no more than 10% wrong auto-adds. Uncertain ones must go to review, not be auto-added.
- No user can read or modify another user's data (add automated tests for this).
- Locked fields are never overwritten by refresh or re-match (add tests).

Add automated tests for: duplicate logic, confidence routing, locked fields, quota enforcement, and user scoping.

## Working agreements

- Ask before changing any "Locked decision".
- Keep secrets in Worker secrets / `.dev.vars` (git-ignored). Never commit keys.
- Keep thresholds, quotas, and source priority in a single config module.
- Write small, reviewable commits per feature. Keep this file up to date as decisions change.
- When something in "Platform constraints" turns out to differ from reality, update this file.
