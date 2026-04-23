# Authentication

## Overview

The streaming dictation app uses session-based authentication with a single user. There is no user registration or multi-user support.

## How It Works

1. The admin sets a bcrypt hash of the desired password in the `PASSWORD_HASH` environment variable.
2. The client sends `POST /auth/login` with `{ "password": "..." }`.
3. The server compares the password against the stored hash using `bcrypt.compare()`.
4. On success, `req.session.userId` is set to `"user"` and a session cookie is returned.
5. All subsequent requests to `/api/*` routes must include the session cookie.
6. The `requireAuth` middleware checks for `req.session.userId` on every API request.

## Session Configuration

| Setting | Value |
|---------|-------|
| Store | SQLite (connect-sqlite3 compatible via `sessions` table) |
| Cookie name | Default (`connect.sid`) |
| httpOnly | Yes |
| Secure | Yes (only in `NODE_ENV=production`) |
| SameSite | `lax` |
| TTL | 7 days (604,800,000 ms) |
| Resave | No |
| Save uninitialized | No |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Signs the session cookie. Must be a random string in production. |
| `PASSWORD_HASH` | bcrypt hash of the login password. If empty, login always fails. |
| `NODE_ENV` | Set to `production` to enable secure cookies (requires HTTPS). |

## Generating a Password Hash

Use Node.js to generate a bcrypt hash:

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-password', 10).then(h => console.log(h))"
```

Or with the globally-installed Node.js:

```bash
node -e "import('bcrypt').then(b => b.hash('your-password', 10).then(h => console.log(h)))"
```

Copy the output (starts with `$2b$...`) into your `.env` file:

```
PASSWORD_HASH=$2b$10$abcdef...
```

## Login Failure

If `PASSWORD_HASH` is empty or not set, all login attempts fail with 401. This is intentional — the app is inaccessible until properly configured.

## Session Expiry

Sessions expire after 7 days of inactivity (cookie `maxAge`). After expiry, the client must re-authenticate via `POST /auth/login`.
