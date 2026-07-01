---
"@labdigital/graphql-fetcher": minor
---

Make Automatic Persisted Queries (APQ) opt-in on the server fetcher
(`initServerFetcher` / `initStrictServerFetcher`) via a new `apq` option,
defaulting to `false` — matching the client fetcher.

When APQ is off (the default), operations without a `documentId` are sent as a
full-query POST directly, skipping the APQ GET round-trip and the
`PersistedQueryNotFound` fallback. Operations that resolve to a `documentId`
(persisted/trusted documents) are always sent as a cacheable GET, regardless of
this flag.

This makes the server fetcher work against gateways that do not implement APQ
(e.g. local development without a persisted-document store).

Based on the opt-in design from #47 by @pvaneveld.
