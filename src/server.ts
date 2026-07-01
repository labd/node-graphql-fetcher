import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { type GraphQLError, print } from "graphql";
import { toe } from "graphql-toe";
import { GraphQLFetcherError } from "./errors";
import {
	type GqlResponse,
	getDocumentId,
	getQueryType,
	hasPersistedQueryError,
	type Logger,
	mergeHeaders,
	type NextFetchRequestConfig,
	type OnGraphQLErrors,
	type OnRequestError,
	reportGraphQLErrors,
	reportRequestError,
} from "./helpers";
import {
	createRequest,
	createRequestBody,
	createRequestURL,
	type GraphQLRequest,
	isPersistedQuery,
} from "./request";

export { GraphQLFetcherError } from "./errors";
export type {
	GraphQLErrorContext,
	Logger,
	OnGraphQLErrors,
	OnRequestError,
	RequestContext,
} from "./helpers";

type RequestOptions = {
	/**
	 * Pass an AbortSignal to the fetch request. Note that when passing a signal
	 * to the fetcher, NextJS will disable cache deduplication, so be careful when
	 * using this option.
	 */
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
	 * Default headers to be sent with each request
	 */
	defaultHeaders?: Headers | Record<string, string>;

	/**
	 * Sets the default timeout duration in ms after which a request will throw a timeout error
	 */
	defaultTimeout?: number;

	/**
	 * If the query should always be sent, even if there is a document id
	 */
	includeQuery?: boolean;

	/**
	 * Enable Automatic Persisted Queries (APQ) for non-persisted operations.
	 *
	 * When `false`, operations without a `documentId` are sent as a full-query
	 * POST directly, skipping the APQ GET round-trip and the
	 * `PersistedQueryNotFound` fallback. Operations that resolve to a
	 * `documentId` (persisted/trusted documents) are unaffected.
	 *
	 * @default true
	 */
	apq?: boolean;

	/**
	 * Function to customize creating the documentId from a query
	 *
	 * @param query
	 */
	createDocumentId?: <TResult, TVariables>(
		query: DocumentTypeDecoration<TResult, TVariables>,
	) => string | undefined;

	/**
	 * Optional logger. When set, the fetcher surfaces failed requests and
	 * persisted-query fallbacks that would otherwise be swallowed.
	 */
	logger?: Logger;

	/**
	 * Called when a response carries GraphQL errors (on a 2xx). The library takes
	 * no action of its own; the callback decides whether to log, ignore, or throw
	 * to escalate. It is awaited, so throwing rejects the fetch call.
	 */
	onGraphQLErrors?: OnGraphQLErrors;

	/**
	 * Called when a request fails with a thrown error (non-2xx, network, or
	 * timeout). Observation/escalation only; `throw` to replace the error.
	 */
	onRequestError?: OnRequestError;
};

type CacheOptions = {
	cache?: RequestCache;
	next?: NextFetchRequestConfig;
};

const tracer = trace.getTracer(
	"@labdigital/graphql-fetcher",
	process.env.PACKAGE_VERSION,
);

// Wraps the initServerFetcher function, which returns the result wrapped in the graphql-toe library. This will throw
// an error if a field is used that had an entry in the error response array
export const initStrictServerFetcher = (url: string, options: Options = {}) => {
	const fetcher = initServerFetcher(url, options);
	return async <TResponse extends Record<string, any>, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		cacheOptions: CacheOptions,
		requestOptions: RequestOptions = {},
	): Promise<TResponse> => {
		const response = await fetcher(
			astNode,
			variables,
			cacheOptions,
			requestOptions,
		);

		return toe<TResponse>(
			response as unknown as {
				data?: TResponse | null | undefined;
				errors?: readonly GraphQLError[] | undefined;
			},
		);
	};
};

export const initServerFetcher =
	(
		url: string,
		{
			dangerouslyDisableCache = false,
			defaultTimeout = undefined,
			defaultHeaders = {},
			includeQuery = false,
			apq = true,
			createDocumentId = getDocumentId,
			logger,
			onGraphQLErrors,
			onRequestError,
		}: Options = {},
	) =>
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		{ cache, next = {} }: CacheOptions,
		options: RequestOptions = {},
	): Promise<GqlResponse<TResponse>> => {
		const query =
			typeof astNode === "string" || astNode instanceof String
				? astNode.toString()
				: print(astNode as Parameters<typeof print>[0]);

		const documentId = createDocumentId(astNode);
		const request = await createRequest(
			query,
			variables,
			documentId,
			includeQuery,
		);
		const requestOptions: RequestOptions = {
			...options,
			signal:
				defaultTimeout !== undefined && !options.signal
					? AbortSignal.timeout(defaultTimeout)
					: options.signal,
			headers: mergeHeaders({ ...defaultHeaders, ...options.headers }),
		};

		// Runs a fetch step and routes a thrown error (non-2xx, network, timeout)
		// to onRequestError before rethrowing. Scoped to the fetch only, so a
		// throwing onGraphQLErrors (a GraphQL-error escalation) is not re-reported.
		const fetchWithErrorReport = async <T>(
			fetchStep: () => Promise<T>,
		): Promise<T> => {
			try {
				return await fetchStep();
			} catch (error) {
				await reportRequestError(error, request, onRequestError);
				throw error;
			}
		};

		// When cache is disabled we always make a POST request and set the
		// cache to no-store to prevent any caching
		if (dangerouslyDisableCache) {
			// If we force the cache field we shouldn't set revalidate at all, it will
			// throw a warning otherwise
			delete next.revalidate;
			delete request.extensions?.persistedQuery;

			return tracer.startActiveSpan(request.operationName, async (span) => {
				try {
					const { body: response, httpResponse } = await fetchWithErrorReport(
						() =>
							gqlPost(
								url,
								request,
								{ ...next, cache: "no-store" },
								requestOptions,
								logger,
							),
					);

					await reportGraphQLErrors(
						response,
						request,
						httpResponse,
						onGraphQLErrors,
					);
					return response as GqlResponse<TResponse>;
				} catch (err: any) {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: err?.message ?? String(err),
					});
					throw err;
				} finally {
					span.end();
				}
			});
		}

		// Skip automatic persisted queries if operation is a mutation
		const queryType = getQueryType(query);
		if (queryType === "mutation") {
			return tracer.startActiveSpan(request.operationName, async (span) => {
				try {
					const { body: response, httpResponse } = await fetchWithErrorReport(
						() =>
							gqlPost(url, request, { cache, next }, requestOptions, logger),
					);

					await reportGraphQLErrors(
						response,
						request,
						httpResponse,
						onGraphQLErrors,
					);
					return response as GqlResponse<TResponse>;
				} catch (err: unknown) {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: err instanceof Error ? err.message : String(err),
					});
					throw err;
				} finally {
					span.end();
				}
			});
		}

		// Otherwise, try to get the cached query
		return tracer.startActiveSpan(request.operationName, async (span) => {
			try {
				// With APQ disabled, a non-persisted operation is POSTed directly with
				// the full query — no APQ GET round-trip or PersistedQueryNotFound
				// fallback. Persisted operations (documentId) still use the GET path.
				const skipApq = !apq && !isPersistedQuery(request);
				if (skipApq) {
					delete request.extensions?.persistedQuery;
				}

				let { body: response, httpResponse } = await fetchWithErrorReport(() =>
					skipApq
						? gqlPost(url, request, { cache, next }, requestOptions, logger)
						: gqlPersistedQuery(
								url,
								request,
								{ cache, next },
								requestOptions,
								logger,
							),
				);

				// If APQ was used and the server doesn't know the hash, retry via POST
				if (
					!skipApq &&
					!isPersistedQuery(request) &&
					hasPersistedQueryError(response)
				) {
					logger?.debug?.("Persisted query not found, falling back to POST", {
						operationName: request.operationName,
					});
					// If the cached query doesn't exist, fall back to POST request and
					// let the server cache it.
					({ body: response, httpResponse } = await fetchWithErrorReport(() =>
						gqlPost(url, request, { cache, next }, requestOptions, logger),
					));
				}

				await reportGraphQLErrors(
					response,
					request,
					httpResponse,
					onGraphQLErrors,
				);
				return response as GqlResponse<TResponse>;
			} catch (err: any) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: err?.message ?? String(err),
				});
				throw err;
			} finally {
				span.end();
			}
		});
	};

const gqlPost = async <TVariables>(
	url: string,
	request: GraphQLRequest<TVariables>,
	{ cache, next }: CacheOptions,
	options: RequestOptions,
	logger?: Logger,
) => {
	const endpoint = new URL(url);
	endpoint.searchParams.append("op", request.operationName);

	const response = await fetch(endpoint.toString(), {
		headers: options.headers,
		method: "POST",
		body: createRequestBody(request),
		cache,
		next,
		signal: options.signal,
	});

	return {
		body: await parseResponse(request, response, logger),
		httpResponse: response,
	};
};

const gqlPersistedQuery = async <TVariables>(
	endpoint: string,
	request: GraphQLRequest<TVariables>,
	{ cache, next }: CacheOptions,
	options: RequestOptions,
	logger?: Logger,
) => {
	const url = createRequestURL(endpoint, request);
	const response = await fetch(url.toString(), {
		method: "GET",
		headers: options.headers,
		cache,
		next,
		signal: options.signal,
	});

	return {
		body: await parseResponse(request, response, logger),
		httpResponse: response,
	};
};

/**
 * Checks if fetch succeeded and parses the response body
 * @param response Fetch response object
 * @returns GraphQL response body
 */
const parseResponse = async (
	request: GraphQLRequest<unknown>,
	response: Response,
	logger?: Logger,
) => {
	if (!response.ok) {
		const error = await GraphQLFetcherError.fromResponse(
			response,
			request.operationName,
		);
		logger?.error?.(error.message, {
			operationName: request.operationName,
			status: error.status,
			statusText: error.statusText,
			body: error.body,
		});
		throw error;
	}

	return await response.json();
};
