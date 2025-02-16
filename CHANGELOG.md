# @labdigital/react-query-opal

## 2.0.0-next.5

### Minor Changes

- bd2d55c: Remove the default timeout signal since the presence of the signal disables nextjs request deduplication

## 2.0.0-next.4

### Patch Changes

- 0fae2a8: Replace `mode` flag via simpler `includeQuery` to indicate if the query should be sent even if there is a documentId available

## 2.0.0-next.3

### Major Changes

- 3dc1d79: Internal refactor to better support persisted operations / trusted documents

## 1.5.0-next.2

### Patch Changes

- 1b03cc8: Resolve import erorr when using library

## 1.5.0-next.1

### Patch Changes

- 83ff174: update `@apollo/utils.createhash` to fix issue with require() in nextjs

## 1.5.0-next.0

### Minor Changes

- Added documentId and default headers

## 1.4.1

### Patch Changes

- 1e1d13d: update imports for ast

## 1.4.0

### Minor Changes

- d5d1ffa: Allow passing headers in server fetcher, mirroring functionality of client fetcher

## 1.3.2

### Patch Changes

- 0686af7: remove json parse from ast node

## 1.3.1

### Patch Changes

- 9a078cf: Fix string serialization of query

## 1.3.0

### Minor Changes

- 27e253b: Skip persisted queries for server-side mutations

## 1.2.0

### Minor Changes

- 549714b: Support passing extra HTTP headers to client fetcher

## 1.1.0

### Minor Changes

- e32ea87: Added request timeout with support for custom signals for request cancelling

## 1.0.1

### Patch Changes

- b14681d: add correct cache property

## 1.0.0

### Major Changes

- 13f885c: Major API update

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

## 0.3.1

### Patch Changes

- f4c2e08: Don't handle graphql errors

## 0.3.0

### Minor Changes

- 5090d2a: Add opentelemetry support for server fetcher

## 0.2.0

### Minor Changes

- 171ad72: Fix APQ and only use it for queries (not mutations)
- 1ac8ef4: Rename package to @labdigital/graphql-fetcher

### Patch Changes

- b59f448: Export the ClientFetcher type

## 0.1.2

### Patch Changes

- 46e0779: Add option to disable cache in server fetcher. This can be set when NODE_ENV === development

## 0.1.1

### Patch Changes

- de89891: Make cache parameter optional for server client

## 0.1.0

### Minor Changes

- 4268399: Allow passing cache (RequestCache) parameter
- 4268399: Remove outputting errors to console.log

## 0.0.5

### Patch Changes

- 35de25c: Move react to peerDependencies

## 0.0.4

### Patch Changes

- ec16b7b: Export GraphQLError type

## 0.0.3

### Patch Changes

- f064b9b: Export the GqlResponse type

## 0.0.2

### Patch Changes

- c7cc1fa: Initial release
