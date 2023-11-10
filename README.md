# react-query-opal

Opinionated `fetch` wrappers for our client and server side queries in our Next.js frontends.
Only used for fetching from GraphQL endpoints.

## Features

- GraphQL support using `TypedDocumentString` as the query
- Persisted queries support using either pregenerated hashes or on the fly hashing
- Fallback when persisted query fails
- Client fetcher with React context support when the endpoint is only known at runtime
- Next data cache support
- Preview mode support to disable all caches

## Notes

### Node 18.x requires webcrypto on globalThis

From node 20.x onwards the WebCrypto API is available on globalThis, versions before 20.x will need a small polyfill:

```
	if (typeof window === "undefined" && !globalThis.crypto) {
		globalThis.crypto = require("node:crypto").webcrypto;
	}
```
