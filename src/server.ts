import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { trace } from "@opentelemetry/api";
import invariant from "tiny-invariant";
import type { GqlResponse, NextFetchRequestConfig } from "./helpers";
import {
	createSha256,
	defaultHeaders,
	errorMessage,
	extractOperationName,
	getQueryHash,
	pruneObject,
} from "./helpers";

type Options = {
	/**
	 * Disables all forms of caching for the fetcher, use only in development
	 *
	 * @default false
	 */
	dangerouslyDisableCache?: boolean;
	/**
	 * Error policy for the fetcher, will either throw an error if the body contains GraphQL errors
	 * or allow the body to be returned with the errors.
	 * - "none" will always throw an error if fetching fails or the body contains GraphQL errors
	 * - "allow-body" will return the body even if it contains GraphQL errors,
	 * you can then handle it in your application logic
	 *
	 * @default "none"
	 */
	errorPolicy?: "none" | "allow-body";
};

type CacheOptions = {
	cache?: RequestCache;
	next?: NextFetchRequestConfig;
};

const tracer = trace.getTracer(
	"@labdigital/graphql-fetcher",
	process.env.PACKAGE_VERSION
);

export const initServerFetcher =
	(
		url: string,
		{ dangerouslyDisableCache = false, errorPolicy = "none" }: Options
	) =>
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		{ cache = "force-cache", next = {} }: CacheOptions
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();
		const operationName = extractOperationName(query) || "(GraphQL)";

		if (dangerouslyDisableCache) {
			// If we force the cache field we shouldn't set revalidate at all, it will throw a warning otherwise
			delete next.revalidate;

			return tracer.startActiveSpan(operationName, async (span) => {
				const response = await gqlPost(
					url,
					JSON.stringify({ operationName, query, variables }),
					{ ...next, cache: "no-store" }
				);

				if (errorPolicy === "none") {
					if (response.errors) {
						throw new Error(errorMessage(`GraphQL errors: ${response.errors}`));
					}
				}

				span.end();
				return response as GqlResponse<TResponse>;
			});
		}

		/**
		 * Replace full queries with generated ID's to reduce bandwidth.
		 * @see https://www.apollographql.com/docs/react/api/link/persisted-queries/#protocol
		 */
		const extensions = {
			persistedQuery: {
				version: 1,
				sha256Hash: getQueryHash(astNode) ?? (await createSha256(query)),
			},
		};

		// Otherwise, try to get the cached query
		return tracer.startActiveSpan(operationName, async (span) => {
			let response = await gqlPersistedQuery(
				url,
				getQueryString(operationName, variables, extensions),
				{ cache, next }
			);

			if (response.errors?.[0]?.message === "PersistedQueryNotFound") {
				// If the cached query doesn't exist, fall back to POST request and let the server cache it.
				response = await gqlPost(
					url,
					JSON.stringify({ operationName, query, variables, extensions }),
					{ cache, next }
				);
			}

			if (errorPolicy === "none") {
				if (response.errors) {
					throw new Error(errorMessage(`GraphQL errors: ${response.errors}`));
				}
			}

			span.end();
			return response as GqlResponse<TResponse>;
		});
	};

const gqlPost = async (
	url: string,
	body: string,
	{ cache, next }: CacheOptions
) => {
	const response = await fetch(url, {
		headers: defaultHeaders,
		method: "POST",
		body,
		cache,
		next,
	});

	return handleResponse(response);
};

const gqlPersistedQuery = async (
	url: string,
	queryString: URLSearchParams,
	{ cache, next }: CacheOptions
) => {
	const response = await fetch(`${url}?${queryString}`, {
		method: "GET",
		headers: defaultHeaders,
		cache,
		next,
	});

	return handleResponse(response);
};

const getQueryString = <TVariables>(
	operationName: string | undefined,
	variables: TVariables | undefined,
	extensions: { persistedQuery: { version: number; sha256Hash: string } }
) =>
	new URLSearchParams(
		pruneObject({
			operationName,
			variables: JSON.stringify(variables),
			extensions: JSON.stringify(extensions),
		})
	);

/**
 * Checks if fetch succeeded, otherwise throws an error.
 *
 * Any additional checks (GraphQL errors, etc.) should be done in the calling function
 * @param response Fetch response object
 * @returns GraphQL response body
 */
const handleResponse = async (response: Response) => {
	invariant(
		response.ok,
		errorMessage(`Response not ok: ${response.status} ${response.statusText}`)
	);

	// Let fetch throw if the body is not JSON-parseable
	return await response.json();
};
