# Authentication

## How it works

Ascend uses short-lived JWT access tokens (15 minutes) and long-lived refresh tokens (7 days). Access tokens are passed in the `Authorization` header; refresh tokens are stored in an `httpOnly` cookie.

## Login

```http
POST /api/identity/login
Content-Type: application/json

{
  "email": "owner@acmecafe.com",
  "password": "your-password"
}
```

**Response (200)**:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "rt_01jz...",
  "expiresIn": 900
}
```

The `refreshToken` is also set as an `httpOnly` cookie (`finder_refresh`). A non-httpOnly hint cookie (`finder_session_hint`) indicates an active session for silent refresh logic.

## Using the access token

Include in every API request:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

## Silent refresh

When the access token expires, exchange the refresh token for a new pair:

```http
POST /api/identity/refresh
Content-Type: application/json

{
  "refreshToken": "rt_01jz..."
}
```

Or rely on the httpOnly cookie — the endpoint reads it automatically if no body is provided.

The old refresh token is invalidated (single-use rotation).

## Logout

```http
POST /api/identity/logout
Authorization: Bearer <token>
```

Revokes the refresh token and clears the httpOnly cookie.

## Current user

```http
GET /api/identity/me
Authorization: Bearer <token>
```

**Response**:
```json
{
  "userId": "usr_01jz...",
  "tenantId": "tnt_demo",
  "role": "owner"
}
```

## API keys (programmatic access)

For server-to-server integration, create an API key (owner only):

```http
POST /api/identity/api-keys
Authorization: Bearer <owner-token>
Content-Type: application/json

{
  "name": "My Integration",
  "scopes": ["catalog:read", "orders:read"],
  "expiresAt": 1893456000000
}
```

Use the returned key value in the `Authorization: Bearer` header. API keys are shown only once — store them securely.

## Multi-factor authentication (MFA)

MFA is optional but recommended for owner accounts.

### Enabling MFA

```http
POST /api/identity/mfa/setup
Authorization: Bearer <token>
```

Returns a TOTP QR code. Scan with an authenticator app, then verify:

```http
POST /api/identity/mfa/verify
Authorization: Bearer <token>
Content-Type: application/json

{ "code": "123456" }
```

MFA is now active. Future logins will require the 6-digit TOTP code.

### Disabling MFA

```http
POST /api/identity/mfa/disable
Authorization: Bearer <token>
```

## Rate limits

Login endpoints: **10 requests per minute per IP**.
All other endpoints: **300 requests per minute per tenant**.

Exceeded limits return `429 Too Many Requests` with a `Retry-After` header (seconds until next allowed request).
