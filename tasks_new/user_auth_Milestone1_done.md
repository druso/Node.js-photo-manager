# Milestone 1: Admin Authentication & Authorization Foundation

- **Reference**: `tasks_new/user_auth.md`, `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`
- **Purpose**: Lock down the SPA and API so only authenticated admins can access existing functionality. Builds on Milestone 0 utilities (env validation, bcrypt/JWT helpers, cookies) to introduce login flow, auth middleware, and admin-only UI gating. No public view yet.
- **Outcome**: Users must authenticate with the configured password; access/refresh token lifecycle works end-to-end; frontend conditionally renders admin features; all existing routes reject unauthenticated requests.

## Step-by-step plan
- **Step 1 — Implement login endpoint**
  - Add `POST /api/auth/login` handler (e.g., `server/routes/auth.js`) using `verifyAdminPassword()` from Milestone 0.
  - On success: issue access + refresh tokens via `tokenService`, set cookies through `authCookieService`, return minimal admin profile payload.
  - On failure: return 401 with generic error (avoid timing leaks by always performing bcrypt compare).
  - **Tests**: Unit/integration tests covering success, wrong password, missing password; verify cookies set with correct flags.

- **Step 2 — Implement token refresh endpoint**
  - Add `POST /api/auth/refresh` that reads refresh token cookie, verifies via `tokenService`, issues new tokens, and rotates cookies.
  - Handle expired/invalid tokens gracefully (clear cookies and return 401).
  - **Tests**: Unit tests verifying valid refresh, expired token, tampered token; ensure cookie rotation occurs.

- **Step 3 — Logout endpoint (client-driven)**
  - Add `POST /api/auth/logout` (optional but helpful) that clears cookies via `authCookieService.clearAuthCookies()`.
  - Client will remove tokens from memory/local storage per spec.
  - **Tests**: Integration test verifying cookies cleared.

- **Step 4 — Auth middleware, SSE policy & route protection**
  - Create middleware (e.g., `requireAdmin`) that validates Authorization header (access token) or cookie, attaches admin context to `req`.
  - Apply middleware to all existing private routes (`server/routes/projects.js`, `photos.js`, `tags.js`, etc.), leaving only new auth endpoints public.
  - Enforce SSE authentication: existing admin SSE channels (`/api/jobs/stream`, `/api/sse/pending-changes`) must require the same auth headers/cookies; public users do **not** subscribe, so add guards to reject unauthenticated connections.
  - **Tests**: Supertest/SSE integration tests ensuring protected endpoints and SSE streams return 401 when unauthenticated and succeed when token present.

- **Step 5 — Frontend auth state management**
  - Create auth client module (`client/src/api/authApi.js`) for login, refresh, logout.
  - Add React context or hook (`useAuth`) to store access token, trigger silent refresh before expiry, and expose login/logout helpers.
  - Persist refresh via httpOnly cookie (handled server-side); store access token in memory (optionally fallback to cookie on SSR fetches).
  - **Tests**: Unit tests for auth hook (mock timers for silent refresh). Manual E2E: login, refresh, logout.

- **Step 6 — Introduce router split for auth/public surfaces**
  - Refactor `client/src/App.jsx` (or extract to `AppRouter.jsx`) to support authenticated admin shell **and** upcoming public routes (`/shared/:hashedKey`, `/login`). Implement centralized auth gate that renders login page when unauthenticated and allows public routes to bypass admin shell when needed.
  - Ensure routing solution (react-router or lightweight custom router) preserves existing state management while enabling future public pages.
  - **Tests**: UI/Cypress tests covering navigation between login, admin shell, and placeholder public route to ensure guards work as expected.

- **Step 7 — Guard SPA routes and components**
  - With router split in place, hide admin-only UI per spec: header icons, filters, modals, commit/revert bars, etc., and ensure public routes render minimal layouts.
  - **Tests**: UI tests verifying blocked access pre-login and full functionality post-login; snapshot tests covering public route layout.

- **Step 8 — Error handling & UX**
  - Build login form component with proper validation feedback and lockout messaging (no password hints).
  - Handle token expiry mid-session: redirect to login if refresh fails.
  - **Tests**: Manual flows for invalid login, expired refresh (simulate via dev tools).

- **Step 9 — Configuration & deployment checklist**
  - Document new env requirements (ensuring Milestone 0 vars deployed) and cookie domain considerations for dev/prod.
  - Confirm HTTPS enforcement to support Secure cookies in prod; update deployment scripts accordingly.
  - **Tests**: Dry run in staging environment; verify cookies flagged correctly over HTTPS.

- `/api/auth/login`, `/api/auth/refresh`, and optional `/api/auth/logout` function as specified with unit/integration coverage.
- All existing protected endpoints return 401 when unauthenticated; pass with valid access token.
- Frontend shows login screen when unauthenticated and restores full admin experience upon login.
- Silent refresh extends sessions up to refresh expiry; failure triggers logout flow.
- Manual regression pass confirms uploads, tagging, commits, etc. still work for authenticated admin.
- SSE channels reject unauthenticated clients and work seamlessly for admins with auth headers/cookies.

## Post-milestone documentation
- Update `PROJECT_OVERVIEW.md`, `SCHEMA_DOCUMENTATION.md`, `SECURITY.md`, and `README.md` with:
  - Auth endpoints and middleware behavior.
  - Token lifetimes and cookie strategy.
  - Login UX instructions for developers/operators.
  - SSE authentication requirements and router split rationale enabling future public routes.