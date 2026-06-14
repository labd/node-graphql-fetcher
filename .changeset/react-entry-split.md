---
"@labdigital/graphql-fetcher": major
---

Move the React provider/hook exports to a dedicated `./react` entry so the package root is framework-neutral.

The root entry previously re-exported the React providers, which call `createContext` at module load. Because the bundle is not code-split, importing **anything** from the root (even the plain `GraphQLFetcherError` class or a type) evaluated `createContext` — which crashes in React Server Components (`createContext is not a function`). The root entry is now React-free and safe to import in RSC / server code; the providers live in `./react` (marked `"use client"`).

**Breaking change — migrate provider/hook imports:**

```diff
- import { ClientGqlFetcherProvider, useClientGqlFetcher } from "@labdigital/graphql-fetcher";
+ import { ClientGqlFetcherProvider, useClientGqlFetcher } from "@labdigital/graphql-fetcher/react";
```

This also applies to `StrictClientGqlFetcherProvider` and `useStrictClientGqlFetcher`. All other exports — `initClientFetcher`, `initStrictClientFetcher`, `GraphQLFetcherError`, and every type (`GqlResponse`, `GraphQLError`, `OnGraphQLErrors`, `OnRequestError`, `RetryOptions`, …) — remain on the package root. The `./server` entry is unchanged.
