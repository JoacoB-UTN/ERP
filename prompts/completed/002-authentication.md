# 002 — Authentication

Status: DONE

## Implemented scope

`apps/api/src/auth`. Argon2id password hashing, short-lived JWT access
tokens (httpOnly cookie) + rotating refresh sessions (`UserSession`),
password reset (`PasswordResetToken`, hashed/single-use/expiring), rate
limiting, structured security-event logging. Login/refresh/logout/
logout-all/me/change-password/forgot-password/reset-password.
`apps/gestion` and `apps/facturacion` login/forgot-password/reset-password
pages via `packages/auth-client`.

## Relevant docs

Root [README.md](../../README.md#authentication) (dedicated
`docs/authentication.md` doesn't exist yet — this remains the most
detailed write-up).

## Verification

`apps/api/test/auth.e2e-spec.ts`, `apps/api/src/auth/*.spec.ts`.
