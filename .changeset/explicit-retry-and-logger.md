---
"@labdigital/graphql-fetcher": minor
---

Add a retry seam, a typed error, and an optional logger to surface failures the fetcher previously swallowed.

- **`retry` option** on the client fetcher: `{ max?, shouldRetry(ctx), onRetry?(ctx) }`. `shouldRetry` receives both the thrown `error` (HTTP-level, e.g. a 401) and the parsed `result` (GraphQL-level, e.g. an auth error code on a 2xx), so an access-token refresh-and-retry can be expressed without wrapping the fetcher.
- **`GraphQLFetcherError`** (exported): thrown on a non-2xx response, carrying `status`, `statusText`, `response`, and the parsed `body`. Previously a non-2xx threw a generic error with only a message string (stripped to `"Invariant failed"` in production builds) and discarded the body.

  Behavioral note: non-2xx responses still throw, and the new error extends `Error`, so `catch`/`instanceof Error`/`.message` consumers are unaffected. Two narrow exceptions: code asserting on the exact error message string (the server message changed from `"… errored: …"` to `"… not ok: …"`), or using strict `error.constructor === Error` equality.
- **`logger` option** (`Logger` type, exported) on both the client and server fetchers: logs failed requests, persisted-query fallbacks, GraphQL errors returned on a 2xx, and retries — conditions that were otherwise silently swallowed.
