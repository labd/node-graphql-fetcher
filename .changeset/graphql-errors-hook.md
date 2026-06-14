---
"@labdigital/graphql-fetcher": minor
---

Add `onGraphQLErrors` and `onRequestError` hooks so consumers can observe and act on failures the fetcher previously swallowed — both on the client and server fetchers. The library takes no action of its own; each hook decides whether to log, ignore, or `throw` to escalate, and both are awaited so a throwing callback rejects the fetch call. They are orthogonal to `retry` (which controls whether to try again) and fire terminally, after retries are exhausted.

- **`onGraphQLErrors`** — fires when a `2xx` response carries GraphQL errors (e.g. a partial-data response where one field errored), which were previously returned in `errors` and easily ignored.
  `(errors: GraphQLError[], context: { operationName, documentId?, variables, response, httpResponse }) => void | Promise<void>`. The context includes the parsed `response` (so the callback can inspect partial `data` alongside the errors) and the raw `httpResponse` (status/headers, e.g. a gateway request id). The internal `PersistedQueryNotFound` signal is filtered out of `errors`.
- **`onRequestError`** — fires when a request fails with a thrown error: a non-2xx response (a `GraphQLFetcherError` carrying `.status`/`.body`/`.response`), or a network/timeout error (which previously logged nothing at all).
  `(error: unknown, context: { operationName, documentId?, variables }) => void | Promise<void>`. Not triggered when `onGraphQLErrors` itself throws (that is a GraphQL-error escalation, not a request failure).
- Exports `OnGraphQLErrors`, `OnRequestError`, `GraphQLErrorContext`, and `RequestContext` types.
- The `GraphQLError` type now includes optional `path` and `locations`.
- The `logger` is now transport-only: it no longer logs GraphQL errors on a 2xx (that is `onGraphQLErrors`' job). It still logs failed requests, persisted-query fallbacks, and retries.
