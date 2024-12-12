import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import invariant from "tiny-invariant";
import {
	getDocumentId,
	GqlResponse,
	NextFetchRequestConfig,
	createSha256,
	defaultHeaders,
	errorMessage,
	extractOperationName,
	getQueryType,
	pruneObject,
} from "./helpers";
import { print } from "graphql";
import { isNode } from "graphql/language/ast.js";

type RequestOptions = {
	signal?: AbortSignal;
	headers?: Headers | Record<string, string>;
};

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

	/**
	 * Default headers to be sent with each request
	 */
	defaultHeaders?: Headers | Record<string, string>;

	/**
	 * Function to customize creating the documentId from a query
	 *
	 * @param query
	 */
	createDocumentId?: <TResult, TVariables>(
		query: DocumentTypeDecoration<TResult, TVariables>
	) => string | undefined;
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
		{
			dangerouslyDisableCache = false,
			defaultTimeout = 30000,
			defaultHeaders = {},
			createDocumentId = <TResult, TVariables>(
				query: DocumentTypeDecoration<TResult, TVariables>
			): string | undefined => getDocumentId(query),
		}: Options = {}
	) =>
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		{ cache, next = {} }: CacheOptions,
		optionsOrSignal: RequestOptions | AbortSignal = {
			signal: AbortSignal.timeout(defaultTimeout),
		} satisfies RequestOptions
	): Promise<GqlResponse<TResponse>> => {
		const query = isNode(astNode) ? print(astNode) : astNode.toString();

		const operationName = extractOperationName(query) || "(GraphQL)";
		const documentId = createDocumentId(astNode);

		// For backwards compatibility, when options is an AbortSignal we transform
		// it into a RequestOptions object
		const options: RequestOptions = {
			headers: defaultHeaders,
		};
		if (optionsOrSignal instanceof AbortSignal) {
			options.signal = optionsOrSignal;
		} else {
			Object.assign(options, optionsOrSignal);
		}

		// Make sure that we always have a default signal set
		if (!options.signal) {
			options.signal = AbortSignal.timeout(defaultTimeout);
		}

		if (dangerouslyDisableCache) {
			// If we force the cache field we shouldn't set revalidate at all, it will
			// throw a warning otherwise
			delete next.revalidate;

			return tracer.startActiveSpan(operationName, async (span) => {
				try {
					const response = await gqlPost(
						url,
						JSON.stringify({ documentId, operationName, query, variables }),
						{ ...next, cache: "no-store" },
						options
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
						JSON.stringify({ documentId, operationName, query, variables }),
						{ cache, next },
						options
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
		 *
		 * Note that these are not the same hashes as the documentId, which is used for allowlisting of query documents
		 */
		const extensions = {
			persistedQuery: {
				version: 1,
				sha256Hash: await createSha256(query),
			},
		};

		// Otherwise, try to get the cached query
		return tracer.startActiveSpan(operationName, async (span) => {
			try {
				let response = await gqlPersistedQuery(
					url,
					getQueryString(documentId, operationName, variables, extensions),
					{ cache, next },
					options
				);

				if (response.errors?.[0]?.message === "PersistedQueryNotFound") {
					// If the cached query doesn't exist, fall back to POST request and let the server cache it.
					response = await gqlPost(
						url,
						JSON.stringify({
							documentId,
							operationName,
							query,
							variables,
						}),
						{ cache, next },
						options
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
	options: RequestOptions
) => {
	const headers = {
		...defaultHeaders,
		...options.headers,
	};
	const response = await fetch(url, {
		headers: headers,
		method: "POST",
		body,
		cache,
		next,
		signal: options.signal,
	});

	return parseResponse(response);
};

const gqlPersistedQuery = async (
	url: string,
	queryString: URLSearchParams,
	{ cache, next }: CacheOptions,
	options: RequestOptions
) => {
	const headers = {
		...defaultHeaders,
		...options.headers,
	};
	const response = await fetch(`${url}?${queryString}`, {
		method: "GET",
		headers: headers,
		cache,
		next,
		signal: options.signal,
	});

	return parseResponse(response);
};

const getQueryString = <TVariables>(
	documentId: string | undefined,
	operationName: string | undefined,
	variables: TVariables | undefined,
	extensions: { persistedQuery: { version: number; sha256Hash: string } }
) =>
	new URLSearchParams(
		pruneObject({
			documentId,
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
