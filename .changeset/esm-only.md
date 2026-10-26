---
"@labdigital/graphql-fetcher": minor
---

Publish as ESM-only. The CommonJS builds (`dist/*.cjs`) are removed; the `.`, `./server` and `./react` entry points now ship `dist/<entry>.js` + `dist/<entry>.d.ts` with `types` and `default` conditions. This also fixes the type resolution for `require`, which previously used the ESM declarations. CommonJS consumers on Node.js >= 22.12 can still `require()` the package.
