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

## Notes

### Node 18.x requires webcrypto on globalThis

From node 20.x onwards the WebCrypto API is available on globalThis, versions before 20.x will need a small polyfill:

```
	if (typeof window === "undefined" && !globalThis.crypto) {
		globalThis.crypto = require("node:crypto").webcrypto;
	}
```
