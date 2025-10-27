import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import invariant from "tiny-invariant";
import {
	getDocumentId,
	type GqlResponse,
	type NextFetchRequestConfig,
	errorMessage,
	getQueryType,
	mergeHeaders,
	hasPersistedQueryError,
} from "./helpers";
import { print } from "graphql";
import { isNode } from "graphql/language/ast.js";
import {
	createRequest,
	createRequestBody,
	createRequestURL,
	type GraphQLRequest,
	isPersistedQuery,
} from "./request";

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
	 * Enable use of automated persisted queries, this will always add a extra
	 * roundtrip to the server if queries aren't cacheable
	 * @default false
	 */
	apq?: boolean;
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
	 * Function to customize creating the documentId from a query
	 *
	 * @param query
	 */
	createDocumentId?: <TResult, TVariables>(
		query: DocumentTypeDecoration<TResult, TVariables>,
	) => string | undefined;
};

type CacheOptions = {
	cache?: RequestCache;
	next?: NextFetchRequestConfig;
};

const tracer = trace.getTracer(
	"@labdigital/graphql-fetcher",
	process.env.PACKAGE_VERSION,
);

export const initServerFetcher =
	(
		url: string,
		{
			dangerouslyDisableCache = false,
			defaultTimeout = undefined,
			defaultHeaders = {},
			includeQuery = false,
			apq = false,
			createDocumentId = getDocumentId,
		}: Options = {},
	) =>
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		{ cache, next = {} }: CacheOptions,
		options: RequestOptions = {},
	): Promise<GqlResponse<TResponse>> => {
		const query = isNode(astNode) ? print(astNode) : astNode.toString();

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

		// When cache is disabled we always make a POST request and set the
		// cache to no-store to prevent any caching
		if (dangerouslyDisableCache) {
			// If we force the cache field we shouldn't set revalidate at all, it will
			// throw a warning otherwise
			delete next.revalidate;
			delete request.extensions?.persistedQuery;

			return tracer.startActiveSpan(request.operationName, async (span) => {
				try {
					const response = await gqlPost(
						url,
						request,
						{ ...next, cache: "no-store" },
						requestOptions,
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

		const queryType = getQueryType(query);
		if (!apq) {
			return post<TResponse, TVariables>(
				request,
				url,
				cache,
				next,
				requestOptions,
			);
		}

		// if apq is enabled, only queries are converted into get calls
		// https://www.apollographql.com/docs/apollo-server/performance/apq#using-get-requests-with-apq-on-a-cdn
		if (queryType === "mutation") {
			return post<TResponse, TVariables>(
				request,
				url,
				cache,
				next,
				requestOptions,
			);
		}

		return get<TResponse, TVariables>(
			request,
			url,
			cache,
			next,
			requestOptions,
		);
	};

const gqlPost = async <TVariables>(
	url: string,
	request: GraphQLRequest<TVariables>,
	{ cache, next }: CacheOptions,
	options: RequestOptions,
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

	return parseResponse(request, response);
};

const gqlPersistedQuery = async <TVariables>(
	endpoint: string,
	request: GraphQLRequest<TVariables>,
	{ cache, next }: CacheOptions,
	options: RequestOptions,
) => {
	const url = createRequestURL(endpoint, request);
	const response = await fetch(url.toString(), {
		method: "GET",
		headers: options.headers,
		cache,
		next,
		signal: options.signal,
	});

	return parseResponse(request, response);
};

/**
 * Checks if fetch succeeded and parses the response body
 * @param response Fetch response object
 * @returns GraphQL response body
 */
const parseResponse = async (
	request: GraphQLRequest<unknown>,
	response: Response,
) => {
	invariant(
		response.ok,
		errorMessage(
			`Response for ${request.operationName} errored: ${response.status} ${response.statusText}`,
		),
	);

	return await response.json();
};
function get<TResponse, TVariables>(
	request: GraphQLRequest<TVariables>,
	url: string,
	cache: RequestCache | undefined,
	next: NextFetchRequestConfig,
	requestOptions: RequestOptions,
): GqlResponse<TResponse> | PromiseLike<GqlResponse<TResponse>> {
	return tracer.startActiveSpan(request.operationName, async (span) => {
		try {
			let response = await gqlPersistedQuery(
				url,
				request,
				{ cache, next },
				requestOptions,
			);

			// If this is not a persisted query, but we tried to use automatic
			// persisted queries (APQ) then we retry with a POST
			if (!isPersistedQuery(request) && hasPersistedQueryError(response)) {
				// If the cached query doesn't exist, fall back to POST request and
				// let the server cache it.
				response = await gqlPost(url, request, { cache, next }, requestOptions);
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
}

function post<TResponse, TVariables>(
	request: GraphQLRequest<TVariables>,
	url: string,
	cache: RequestCache | undefined,
	next: NextFetchRequestConfig,
	requestOptions: RequestOptions,
): GqlResponse<TResponse> | PromiseLike<GqlResponse<TResponse>> {
	return tracer.startActiveSpan(request.operationName, async (span) => {
		try {
			const response = await gqlPost(
				url,
				request,
				{ cache, next },
				requestOptions,
			);

			span.end();
			return response as GqlResponse<TResponse>;
		} catch (err: unknown) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err),
			});
			throw err;
		}
	});
}
