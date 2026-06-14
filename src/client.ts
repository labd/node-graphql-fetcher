import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { type GraphQLError, print } from "graphql";
import { toe } from "graphql-toe";
import {
	createRequest,
	createRequestBody,
	createRequestURL,
	isPersistedQuery,
} from "request";
import { GraphQLFetcherError } from "./errors";
import {
	type GqlResponse,
	getDocumentId,
	getQueryType,
	hasPersistedQueryError,
	type Logger,
	mergeHeaders,
} from "./helpers";

/**
 * Context passed to the retry callbacks describing the attempt that just
 * completed.
 */
export type RetryContext = {
	/** Parsed GraphQL response, present when the request completed with a 2xx. */
	result?: GqlResponse<unknown>;
	/**
	 * Error thrown while fetching, present on failure -- a `GraphQLFetcherError`
	 * for a non-2xx response (inspect `.status`) or a network/timeout error.
	 */
	error?: unknown;
	/** Zero-based index of the attempt that just completed. */
	attempt: number;
};

export type RetryOptions = {
	/**
	 * Maximum number of retries, in addition to the initial attempt.
	 * @default 1
	 */
	max?: number;

	/**
	 * Decides whether to retry after an attempt. Receives both the parsed
	 * `result` (for GraphQL-level signals on a 2xx, e.g. an auth error code) and
	 * the thrown `error` (for HTTP-level failures, e.g. a 401).
	 */
	shouldRetry: (ctx: RetryContext) => boolean | Promise<boolean>;

	/**
	 * Runs after `shouldRetry` returns true and before the next attempt, e.g. to
	 * refresh an access token. Cookies set here are picked up on the retry since
	 * requests use `credentials: "include"`.
	 */
	onRetry?: (ctx: RetryContext) => void | Promise<void>;
};

type Options = {
	/**
	 * Enable use of automated persisted queries, this will always add a extra
	 * roundtrip to the server if queries aren't cacheable
	 * @default false
	 */
	apq?: boolean;

	/** Deprecated: use `apq: <boolean>` */
	persistedQueries?: boolean;

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
	 * If the query should always be sent, even if there is a document id
	 */
	includeQuery?: boolean;

	/**
	 * Function to customize creating the documentId from a query
	 *
	 * @param query
	 */
	createDocumentId?: <TResult, TVariables>(
		query: DocumentTypeDecoration<TResult, TVariables>,
	) => string | undefined;

	/**
	 * Optional retry policy. When set, a failed attempt (a thrown error or a
	 * parsed result) is passed to `shouldRetry`; if it returns true, `onRetry`
	 * runs and the whole request is re-executed.
	 */
	retry?: RetryOptions;

	/**
	 * Optional logger. When set, the fetcher surfaces conditions it would
	 * otherwise swallow: failed requests, persisted-query fallbacks, GraphQL
	 * errors returned on a 2xx response, and retries.
	 */
	logger?: Logger;
};

type RequestOptions = {
	signal?: AbortSignal;
	headers?: Headers | Record<string, string>;
};

export type StrictClientFetcher = <
	TResponse extends Record<string, any>,
	TVariables,
>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables,
	options?: RequestOptions,
) => Promise<TResponse>;

// Wraps the initServerFetcher function, which returns the result wrapped in the graphql-toe library. This will throw
// an error if a field is used that had an entry in the error response array
export const initStrictClientFetcher = (
	url: string,
	options: Options = {},
): StrictClientFetcher => {
	const fetcher = initClientFetcher(url, options);
	return async <TResponse extends Record<string, any>, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables?: TVariables,
		options?: RequestOptions,
	): Promise<TResponse> => {
		const response = await fetcher(astNode, variables, options);

		return toe<TResponse>(
			response as unknown as {
				data?: TResponse | null | undefined;
				errors?: readonly GraphQLError[] | undefined;
			},
		);
	};
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables,
	options?: RequestOptions,
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher =
	(
		endpoint: string,
		{
			apq = false,
			persistedQueries = false,
			defaultTimeout = 30000,
			defaultHeaders = {},
			includeQuery = false,
			createDocumentId = getDocumentId,
			retry,
			logger,
		}: Options = {},
	): ClientFetcher =>
	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all
	 * user information is only used after rendering the page for caching reasons.
	 */
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables?: TVariables,
		options: RequestOptions = {
			signal: AbortSignal.timeout(defaultTimeout),
		},
	): Promise<GqlResponse<TResponse>> => {
		// Make sure that we always have a default signal set
		if (!options.signal) {
			options.signal = AbortSignal.timeout(defaultTimeout);
		}

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

		const headers = mergeHeaders({ ...defaultHeaders, ...options.headers });

		const queryType = getQueryType(query);

		apq = apq || persistedQueries;

		// A single end-to-end attempt: the (optional) persisted GET plus the POST
		// fallback. The retry wrapper re-runs this whole function, so cookies
		// refreshed in `onRetry` are picked up on the next attempt.
		const execute = async (): Promise<GqlResponse<TResponse>> => {
			let response: GqlResponse<TResponse> | undefined;

			// For queries we can use GET requests if persisted queries are enabled
			if (queryType === "query" && (apq || isPersistedQuery(request))) {
				const url = createRequestURL(endpoint, request);
				response = await parseResponse<GqlResponse<TResponse>>(
					() =>
						fetch(url.toString(), {
							headers: headers,
							method: "GET",
							credentials: "include",
							signal: options.signal,
						}),
					request.operationName,
					logger,
				);
			}

			// For failed APQ calls or mutations we need to fall back to POST requests
			if (
				!response ||
				(!isPersistedQuery(request) && hasPersistedQueryError(response))
			) {
				if (response) {
					logger?.debug?.("Persisted query not found, falling back to POST", {
						operationName: request.operationName,
					});
				}

				const url = new URL(endpoint);
				url.searchParams.append("op", request.operationName);

				// Persisted query not used or found, fall back to POST request and
				// include extension to cache the query on the server
				response = await parseResponse<GqlResponse<TResponse>>(
					() =>
						fetch(url.toString(), {
							headers: headers,
							method: "POST",
							body: createRequestBody(request),
							credentials: "include",
							signal: options.signal,
						}),
					request.operationName,
					logger,
				);
			}

			// Surface GraphQL errors that come back on a 2xx -- these are returned
			// in the response and routinely ignored by callers. The expected
			// PersistedQueryNotFound signal is excluded as it drives the fallback
			// above rather than being a real failure.
			const errors = response.errors?.filter(
				(error) => error.message !== "PersistedQueryNotFound",
			);
			if (errors?.length) {
				logger?.warn?.("GraphQL response contained errors", {
					operationName: request.operationName,
					errors,
				});
			}

			return response;
		};

		return runWithRetry(execute, retry, logger);
	};

/**
 * Runs `execute`, consulting the retry policy after each attempt. Without a
 * policy it runs exactly once. The policy sees both a thrown error and a parsed
 * result so it can react to HTTP-level (e.g. 401) and GraphQL-level (e.g. an
 * auth error code on a 2xx) failures alike.
 */
const runWithRetry = async <T>(
	execute: () => Promise<GqlResponse<T>>,
	retry?: RetryOptions,
	logger?: Logger,
): Promise<GqlResponse<T>> => {
	if (!retry) {
		return execute();
	}

	const max = retry.max ?? 1;
	let attempt = 0;

	while (true) {
		let result: GqlResponse<T> | undefined;
		let error: unknown;
		let failed = false;
		try {
			result = await execute();
		} catch (err) {
			failed = true;
			error = err;
		}

		if (attempt < max) {
			const ctx: RetryContext = { result, error, attempt };
			if (await retry.shouldRetry(ctx)) {
				logger?.debug?.("Retrying request", {
					attempt,
					status:
						error instanceof GraphQLFetcherError ? error.status : undefined,
				});
				await retry.onRetry?.(ctx);
				attempt++;
				continue;
			}
		}

		if (failed) {
			throw error;
		}
		return result as GqlResponse<T>;
	}
};

/**
 * Checks if fetch succeeded and parses the response body
 * @returns GraphQL response body
 * @param fetchFn
 * @param operationName operation name, attached to the thrown error for context
 */
const parseResponse = async <T>(
	fetchFn: () => Promise<Response>,
	operationName?: string,
	logger?: Logger,
): Promise<T> => {
	const response = await fetchFn();
	if (!response.ok) {
		const error = await GraphQLFetcherError.fromResponse(
			response,
			operationName,
		);
		logger?.error?.(error.message, {
			operationName,
			status: error.status,
			statusText: error.statusText,
			body: error.body,
		});
		throw error;
	}

	return (await response.json()) as T;
};
