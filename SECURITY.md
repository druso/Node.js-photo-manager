# Security Notes

This document summarizes the current download security measures, safe defaults for local development, and recommendations for future hardening (user authentication and packaging).

## What Is In Place Now

- Signed, expiring download URLs for file delivery (JPG/RAW/ZIP) using an HMAC token.
  - Token payload includes: project folder, filename, type, expiry, and a random `jti`.
  - Default expiry (TTL): 2 minutes.
  - Implemented in `server/routes/assets.js` and `server/utils/signedUrl.js`.
- Frontend requests a one-time signed URL before downloading.
- Backend download endpoints verify the token by default.
- Local dev toggles via env:
  - `REQUIRE_SIGNED_DOWNLOADS=false` disables token enforcement (for quick local testing).
  - `DOWNLOAD_SECRET` sets the signing secret (defaults to a dev only value – change it for real use).

## Local Development (No Auth, Simple Setup)

- Keep `REQUIRE_SIGNED_DOWNLOADS=true` for safer local use, or set to `false` if needed temporarily.
- No CORS/HTTPS is required for local usage in this project’s default setup.
- Minimal operational friction: single server secret, no external dependencies.

## Future: User Authentication & Multi‑Tenant Projects

When introducing user accounts and per‑user projects:

- Gate the minting endpoint `POST /api/projects/:folder/download-url` by user session/JWT.
  - Ensure the authenticated user owns or has access to `:folder`.
- Include `userId` (or tenant id) in the token payload to bind URLs to an identity.
- Optionally, add single‑use tokens by storing the `jti` in an LRU cache or Redis with a TTL and marking consumed tokens as used.
- Consider short TTLs (30–60s) and rate limiting on mint endpoints.

## Future: Local Packaging (Desktop/Local-Only)

- You may disable signed URL enforcement for an air‑gapped desktop build by default and enable it via a config toggle.
- Keep the same HMAC signing code to allow optional hardening without network complexity.
- If you introduce a local user model, follow the same mint‑gating pattern as above.

## Additional Hardening (Optional)

- Validate inputs strictly: `projectFolder`, `filename`, and `type` must match manifest entries and allowed extensions.
- Enforce HTTPS when deployed beyond localhost.
- Restrict CORS if cross‑origin access is not required.
- Add rate limiting to download and mint endpoints.
- Audit logging for minted and redeemed tokens (without logging secrets).

## Environment Variables

- `REQUIRE_SIGNED_DOWNLOADS` (default: true)
  - Set to `false` to allow direct downloads without a token (not recommended except for quick local tests).
- `DOWNLOAD_SECRET`
  - HMAC secret. Set a strong value in non‑dev environments.

## Files & Endpoints

- Backend
  - `server/utils/signedUrl.js` – HMAC signing/verifying helpers
  - `server/routes/assets.js` – token verification on downloads; `POST /api/projects/:folder/download-url` to mint URLs
- Frontend
  - `client/src/components/PhotoViewer.jsx` – requests signed URL then downloads via fetch+blob
