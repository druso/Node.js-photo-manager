# Milestone 0: Preflight Auth & Data Foundations

- **Reference**: `tasks_new/user_auth.md`
- **Purpose**: Bootstrap secure authentication primitives and database scaffolding without exposing new routes yet, so later milestones inherit a hardened baseline.
- **Outcome**: Server fails fast when auth env vars are missing, bcrypt/JWT helpers exist (1 h access / 7 d refresh with silent refresh support), cookie strategy is codified, and schema migrations for visibility/shared links are drafted. Bcrypt cost is configurable via `AUTH_BCRYPT_COST`.

## Step-by-step plan
- **Step 1 — Audit existing configuration surface**
  - Review `config.default.json`, `README.md`, and `PROJECT_OVERVIEW.md` for legacy auth assumptions or conflicting settings.
  - Inventory current env-driven secrets (uploads, SSE, etc.) to ensure new auth vars fit existing conventions.
  - **Tests**: Run `npm run dev` (backend) to confirm baseline boot—no functionality change expected yet.

- **Step 2 — Define environment contract**
  - Introduce required env vars: `AUTH_ADMIN_BCRYPT_HASH`, `AUTH_JWT_SECRET_ACCESS`, `AUTH_JWT_SECRET_REFRESH`, and configurable `AUTH_BCRYPT_COST` (document safe range, e.g., 8–14, default 12).
  - Update `.env.example` (or add if missing) and developer docs with bcrypt hash generation snippet and note that cost defaults to 12 when unset.
  - **Tests**: Lint/format docs; manually run documented hash-generation command to verify guidance.

- **Step 3 — Implement startup validation**
  - Add `server/services/auth/authConfig.js` to read env vars, validate bcrypt hash format, parse `AUTH_BCRYPT_COST`, and ensure JWT secrets exist; export token lifetimes/constants.
  - Enforce cost bounds (reject <8 or >14 unless explicitly allowed) and default to 12 when env var absent.
  - Wire validation into `server.js` before Express initializes; fail fast with descriptive error when misconfigured.
  - **Tests**: Unit tests for success/failure paths (missing vars, invalid hash, out-of-range cost); manual `npm run dev` without vars should exit with clear messaging.

- **Step 4 — Build password verification helper**
  - Create `server/services/auth/passwordUtils.js` exposing `verifyAdminPassword(plaintext)` that uses bcrypt compare against the configured hash.
  - Provide a utility script/helper for generating hashes honoring `AUTH_BCRYPT_COST` (useful in tests/local tooling).
  - **Tests**: Unit tests verifying correct acceptance/rejection scenarios; ensure helper gracefully handles empty input.

- **Step 5 — Implement token & cookie services**
  - Create `tokenService.js` with helpers to issue/verify access tokens (1 h) and refresh tokens (7 d), embedding minimal claims (e.g., `role: 'admin'`) plus issuer/audience metadata.
  - Create `authCookieService.js` encapsulating cookie behavior: set refresh token as `httpOnly`, `Secure`, `SameSite=Strict`; optionally mirror access token if we decide to deliver via cookie in addition to Authorization header.
  - **Tests**: Unit tests confirming expiry claims, signature validation, cookie attributes (using mocked Express `res`).

- **Step 6 — Choose migration mechanism & sketch schema migrations**
  - Decide whether to continue with inline `ensureColumn()`-style updates or introduce a dedicated migration runner (e.g., `server/services/migrations/runner.js`). Document the decision and implement the necessary scaffolding before authoring SQL (prefer the runner if multiple structural changes expected).
  - Draft migration scripts (per chosen mechanism, stored but not applied) to add:
    - `photos.visibility` (`TEXT` default `'private'`).
    - `public_links` table (`id`, `title`, `description`, `hashed_key`, timestamps).
    - `photo_public_links` join table (FK -> `photos`, `public_links`).
  - Plan necessary indices for visibility filters and shared-link lookups per `tasks_new/user_auth.md` requirements.
  - **Tests**: Dry-run migrations against a scratch SQLite DB (apply + rollback) to confirm validity.

- **Step 7 — Operational checklist**
  - Document rollout order for new env vars, how to rotate the bcrypt hash and adjust `AUTH_BCRYPT_COST`, and guidance for local overrides (`.env.local`).
  - Capture fallback plan if misconfiguration blocks deploy (e.g., temporary feature flag to bypass auth for hotfix).
  - **Tests**: Peer review operational notes for alignment with deployment pipeline expectations.

## Acceptance criteria
- Server refuses to start when `AUTH_ADMIN_BCRYPT_HASH`, JWT secrets, or a valid `AUTH_BCRYPT_COST` are missing/malformed.
- Password, token, and cookie helpers are unit-tested and ready for Milestone 1 integration.
- Default policies documented (access token 1 h, refresh token 7 d, bcrypt cost default 12). Configurable cost validated via env.
- Visibility/shared-link migration scripts exist, linted, and reviewed (remain unapplied).
- Developer documentation explains new env vars, bcrypt cost guidance, and token handling expectations.

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md` (note migration mechanism decision), `SECURITY.md`, and `README.md` to reflect new auth configuration, token policy, bcrypt cost configurability, and planned schema changes.
