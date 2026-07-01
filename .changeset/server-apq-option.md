---
"@labdigital/graphql-fetcher": minor
---

Add an `apq` option to the server fetcher (`initServerFetcher` / `initStrictServerFetcher`).

When set to `false`, non-persisted operations (no `documentId`) are sent as a
full-query POST directly, skipping the Automatic Persisted Queries GET round-trip
and the `PersistedQueryNotFound` fallback. Operations that resolve to a
`documentId` are unaffected. Defaults to `true` (unchanged behavior).

Useful when running against a gateway that does not implement APQ — e.g. local
development without a persisted-document store.
