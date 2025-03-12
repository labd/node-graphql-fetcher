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
