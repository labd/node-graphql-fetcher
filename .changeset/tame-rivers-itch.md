---
"@labdigital/graphql-fetcher": major
---

Major API update

## Background

Current versions had some inconsistencies in the API and a few bugs related to persisted queries if they would fail.
They would also trigger a lot of Next.js errors during development as we force both revalidate to 0 and cache to `no-cache`.

To make error usage more consistent we'll just throw if fetching fails or parsing of JSON fails. Any other errors (like GraphQL body errors) need to be handled by the consumer package.
There are also no longer any event hooks available as the only one current in use (`beforeRequest`) could just as well be run before calling the fetcher.

## Breaking changes

- initServerFetcher() options `disableCache` has been renamed to `dangerouslyDisableCache` because it can be dangerous when enabled in production
- Server fetcher params now use a single object for cache and next options instead of positional arguments
	- e.g. `{ cache: "force-cache", next: { revalidate: 900 }}`
- Server fetcher default fetch cache option has been changed (`"force-cache"` -> `"default"`)
- Server fetcher with dangerouslyDisableCache will now set `cache: "no-store"` and remove the revalidate key from the next object as to not trigger warnings and errors in Next.js
- Client fetcher option has been renamed (`persisted` -> `persistedQueries`)
- Client fetcher option `onBeforeRequest` has been removed, package consumers will have to run their own function before starting the fetch

