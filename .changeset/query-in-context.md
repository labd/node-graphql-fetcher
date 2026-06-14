---
"@labdigital/graphql-fetcher": patch
---

Add the GraphQL `query` string to the error-hook context (`RequestContext`), so `onGraphQLErrors` and `onRequestError` callbacks can log the actual query for diagnostics — not just the `operationName` / `documentId`. Purely additive; existing callbacks are unaffected.
