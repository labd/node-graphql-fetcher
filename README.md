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

## Logging

Both `initClientFetcher` and `initServerFetcher` accept an optional `logger`.
When set, the fetcher surfaces conditions it would otherwise swallow: failed
requests, persisted-query fallbacks, GraphQL errors returned on a 2xx response,
and retries. All methods are optional, so you can pass `console` or a partial
object.

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

### Node 18.x requires webcrypto on globalThis

From node 20.x onwards the WebCrypto API is available on globalThis, versions before 20.x will need a small polyfill:

```
	if (typeof window === "undefined" && !globalThis.crypto) {
		globalThis.crypto = require("node:crypto").webcrypto;
	}
```

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
