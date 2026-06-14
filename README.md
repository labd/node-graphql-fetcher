# @labdigital/graphql-fetcher
<a href="https://npm.im/@labdigital/graphql-fetcher"><img src="https://badgen.net/npm/v/@labdigital/graphql-fetcher"></a> <a href="https://npm.im/@labdigital/graphql-fetcher">

Opinionated `fetch` wrappers for our client and server side queries in our Next.js frontends.
Only used for fetching from GraphQL endpoints.

## Features

- GraphQL support using `TypedDocumentString` as the query
- Persisted queries support using either pregenerated hashes or on the fly hashing
- Fallback when persisted query fails
- Client fetcher with React context support when the endpoint is only known at runtime
- Next data cache support
- Retry hook for refresh-and-retry flows (e.g. on a 401)
- Typed `GraphQLFetcherError` carrying the HTTP status and response body
- `onGraphQLErrors` / `onRequestError` hooks to observe or escalate failures
- Optional structured logger to surface otherwise-swallowed failures


## Usage

```ts
import { initClientFetcher } from "@labdigital/graphql-fetcher";

const fetcher = initClientFetcher("https://localhost/graphql");

const gqlResponse = await fetcher(query, {
	myVar: "baz",
}, {
	signal: AbortSignal.timeout(10),
	headers: {
		"X-extra-header": "foo",
	}
});
```

## Retrying requests

The client fetcher accepts an optional `retry` policy. After each attempt the
policy's `shouldRetry` is called; if it returns `true`, `onRetry` runs and the
whole request is re-executed (up to `max` retries, default `1`).

`shouldRetry` receives both:

- `error` — the thrown error on an HTTP-level failure. A non-2xx response throws
  a `GraphQLFetcherError`, so you can branch on `error.status`.
- `result` — the parsed GraphQL response when the request completed with a 2xx,
  so you can branch on a GraphQL-level error code (e.g. an auth error returned
  alongside a `200`).

### Refresh an access token on a 401

```ts
import {
	initClientFetcher,
	GraphQLFetcherError,
} from "@labdigital/graphql-fetcher";

const fetcher = initClientFetcher("https://localhost/graphql", {
	retry: {
		max: 1,
		shouldRetry: ({ error }) =>
			error instanceof GraphQLFetcherError && error.status === 401,
		onRetry: async () => {
			// Refresh the session before the request is retried. Cookies set here
			// are picked up automatically since requests use `credentials: "include"`.
			await refreshAccessToken();
		},
	},
});
```

### Retry on a GraphQL error code returned with a 2xx

```ts
const fetcher = initClientFetcher("https://localhost/graphql", {
	retry: {
		shouldRetry: ({ result }) =>
			result?.errors?.some(
				(error) => error.extensions?.code === "REQUIRES_SESSION",
			) ?? false,
		onRetry: async () => {
			await createGuestSession();
		},
	},
});
```

## Error handling

A non-2xx response throws a `GraphQLFetcherError`. Unlike a generic `Error`, it
carries the HTTP status and the parsed response body, so you can inspect the
failure without parsing a message string:

```ts
import { GraphQLFetcherError } from "@labdigital/graphql-fetcher";

try {
	await fetcher(query, variables);
} catch (error) {
	if (error instanceof GraphQLFetcherError) {
		console.error(error.status, error.statusText, error.body);
	}
	throw error;
}
```

## Error hooks

Two optional hooks let you observe or escalate failures the fetcher would
otherwise swallow. They are available on both the client and server fetchers.
The library takes no action of its own — each hook decides whether to log,
ignore, or `throw` to escalate. Both are **awaited**, so throwing (or returning
a rejecting promise) rejects the fetch call. They are **orthogonal to `retry`**
(which controls whether to try again) and fire **terminally**, after any retries
are exhausted.

### `onGraphQLErrors` — GraphQL errors on a 2xx

Fires when a `2xx` response carries GraphQL errors (e.g. a partial-data response
where one field errored). These are returned in `errors` and easily ignored,
which leads to silent failures downstream. The callback receives the errors and
a context with the request, the parsed `response` (inspect partial `data`), and
the raw `httpResponse` (status / headers, e.g. a gateway request id). The
internal `PersistedQueryNotFound` fallback signal is filtered out.

```ts
const fetcher = initServerFetcher("https://localhost/graphql", {
	onGraphQLErrors: (errors, { operationName, variables, response }) => {
		// Log, ignore legitimate partial data, or throw to escalate.
		logger.warn({ operationName, variables, errors }, "GraphQL errors");
	},
});
```

### `onRequestError` — the request threw

Fires when a request fails with a thrown error: a non-2xx response (a
`GraphQLFetcherError` carrying `.status` / `.body` / `.response`), or a
network / timeout error (which otherwise logs nothing at all). It is **not**
triggered when `onGraphQLErrors` itself throws — that is a GraphQL-error
escalation, not a request failure.

```ts
import { GraphQLFetcherError } from "@labdigital/graphql-fetcher";

const fetcher = initServerFetcher("https://localhost/graphql", {
	onRequestError: (error, { operationName }) => {
		const status =
			error instanceof GraphQLFetcherError ? error.status : undefined;
		logger.error({ operationName, status, err: error }, "Request failed");
	},
});
```

## Logging

Both `initClientFetcher` and `initServerFetcher` accept an optional `logger`.
It surfaces **transport-level** conditions that would otherwise be swallowed:
failed requests, persisted-query fallbacks, and retries. (GraphQL errors on a
2xx are handled by `onGraphQLErrors` instead, since whether they are fatal is a
consumer concern.) All methods are optional, so you can pass `console` or a
partial object.

```ts
const fetcher = initClientFetcher("https://localhost/graphql", {
	logger: {
		debug: (message, meta) => logger.debug(meta, message),
		warn: (message, meta) => logger.warn(meta, message),
		error: (message, meta) => logger.error(meta, message),
	},
});
```

## Notes

### Old browsers might need a AbortSignal.timeout() polyfill

Old browsers might not have AbortSignal.timeout() available. We do not support these versions but you can add a polyfill using the following code:

```typescript
// Polyfill for AbortSignal.timeout() for older browsers
if (typeof AbortSignal !== "undefined" && !AbortSignal.timeout) {
	AbortSignal.timeout = function timeout(ms: number) {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), ms);
		return controller.signal;
	};
}

export {};
```
