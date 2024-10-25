import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import invariant from "tiny-invariant";
import type { GqlResponse, NextFetchRequestConfig } from "./helpers";
import {
	createSha256,
	defaultHeaders,
	errorMessage,
	extractOperationName,
	getQueryHash,
	getQueryType,
	pruneObject,
} from "./helpers";
import { print } from "graphql";
import { isNode } from "graphql/language/ast";

type Options = {
	/**
	 * Disables all forms of caching for the fetcher, use only in development
	 *
	 * @default false
	 */
	dangerouslyDisableCache?: boolean;

	/**
	 * Sets the default timeout duration in ms after which a request will throw a timeout error
	 *
	 * @default 30000
	 */
	defaultTimeout?: number;
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
		{ dangerouslyDisableCache = false, defaultTimeout = 30000 }: Options = {}
	) =>
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		{ cache, next = {} }: CacheOptions,
		signal: AbortSignal = AbortSignal.timeout(defaultTimeout)
	): Promise<GqlResponse<TResponse>> => {
		const query = isNode(astNode) ? print(astNode) : astNode.toString();

		const operationName = extractOperationName(query) || "(GraphQL)";

		if (dangerouslyDisableCache) {
			// If we force the cache field we shouldn't set revalidate at all, it will throw a warning otherwise
			delete next.revalidate;

			return tracer.startActiveSpan(operationName, async (span) => {
				try {
					const response = await gqlPost(
						url,
						JSON.stringify({ operationName, query, variables }),
						{ ...next, cache: "no-store" },
						signal
					);

					span.end();
					return response as GqlResponse<TResponse>;
				} catch (err: any) {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: err?.message ?? String(err),
					});
					throw err;
				}
			});
		}

		// Skip persisted queries if operation is a mutation
		const queryType = getQueryType(query);
		if (queryType === "mutation") {
			return tracer.startActiveSpan(operationName, async (span) => {
				try {
					const response = await gqlPost(
						url,
						JSON.stringify({ operationName, query, variables }),
						{ cache, next }
					);

					span.end();
					return response as GqlResponse<TResponse>;
				} catch (err: any) {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: err?.message ?? String(err),
					});
					throw err;
				}
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
			try {
				let response = await gqlPersistedQuery(
					url,
					getQueryString(operationName, variables, extensions),
					{ cache, next },
					signal
				);

				if (response.errors?.[0]?.message === "PersistedQueryNotFound") {
					// If the cached query doesn't exist, fall back to POST request and let the server cache it.
					response = await gqlPost(
						url,
						JSON.stringify({ operationName, query, variables, extensions }),
						{ cache, next },
						signal
					);
				}

				span.end();
				return response as GqlResponse<TResponse>;
			} catch (err: any) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: err?.message ?? String(err),
				});
				throw err;
			}
		});
	};

const gqlPost = async (
	url: string,
	body: string,
	{ cache, next }: CacheOptions,
	signal: AbortSignal = AbortSignal.timeout(30000)
) => {
	const response = await fetch(url, {
		headers: defaultHeaders,
		method: "POST",
		body,
		cache,
		next,
		signal,
	});

	return parseResponse(response);
};

const gqlPersistedQuery = async (
	url: string,
	queryString: URLSearchParams,
	{ cache, next }: CacheOptions,
	signal: AbortSignal = AbortSignal.timeout(30000)
) => {
	const response = await fetch(`${url}?${queryString}`, {
		method: "GET",
		headers: defaultHeaders,
		cache,
		next,
		signal,
	});

	return parseResponse(response);
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
 * Checks if fetch succeeded and parses the response body
 * @param response Fetch response object
 * @returns GraphQL response body
 */
const parseResponse = async (response: Response) => {
	invariant(
		response.ok,
		errorMessage(`Response not ok: ${response.status} ${response.statusText}`)
	);

	return await response.json();
};
