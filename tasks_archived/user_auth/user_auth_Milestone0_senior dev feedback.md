# Milestone 0 – Senior Dev Review

- **Bootstrap hash workflow is blocked**: `generateAdminPasswordHash()` in `server/services/auth/passwordUtils.js` calls `ensureAuthConfig()`, which rejects when `AUTH_ADMIN_BCRYPT_HASH` is unset. That prevents operators from generating the *first* hash—the helper can only run after a valid hash already exists. Please decouple the generator from the cached config (accept injected cost/defaults directly) so we can bootstrap from an empty environment.
- **Resolution**: `generateAdminPasswordHash()` now accepts `{ skipConfig: true }` to bypass config lookup and defaults to `DEFAULT_BCRYPT_COST`, enabling first-hash generation. Covered by new test `generateAdminPasswordHash can bootstrap without auth config when skipConfig provided`.

- **Override cost bypasses validation**: The optional `costOverride` argument in `generateAdminPasswordHash()` is never range-checked, so callers can unintentionally mint hashes with rounds outside the documented 8–14 window. Reuse the same guardrails as `authConfig.parseBcryptCost()` to keep hashes aligned with policy.
- **Resolution**: Cost override path now funnels through shared validation (`coerceCost`), rejecting values outside 8–14. Tests assert rejection for 4 and 20 to guard regressions.

- **Follow-up (optional, for future milestone planning)**: consider adding a simple smoke test around `initAuth()` that stubs `exit` so we have coverage for the fail-fast path. Not blocking the milestone but would catch regressions quickly.