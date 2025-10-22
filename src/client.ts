import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { type GraphQLError, print } from "graphql";
import { isNode } from "graphql/language/ast.js";
import {
	createRequest,
	createRequestBody,
	createRequestURL,
	isPersistedQuery,
} from "request";
import invariant from "tiny-invariant";
import {
	errorMessage,
	getDocumentId,
	getQueryType,
	hasPersistedQueryError,
	mergeHeaders,
	type GqlResponse,
} from "./helpers";
import { toe } from "graphql-toe";

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

		const query = isNode(astNode) ? print(astNode) : astNode.toString();
		const documentId = createDocumentId(astNode);
		const request = await createRequest(
			query,
			variables,
			documentId,
			includeQuery,
		);

		let response: GqlResponse<TResponse> | undefined = undefined;
		const headers = mergeHeaders({ ...defaultHeaders, ...options.headers });

		const queryType = getQueryType(query);

		apq = apq || persistedQueries;

		// For queries we can use GET requests if persisted queries are enabled
		if (queryType === "query" && (apq || isPersistedQuery(request))) {
			const url = createRequestURL(endpoint, request);
			response = await parseResponse<GqlResponse<TResponse>>(() =>
				fetch(url.toString(), {
					headers: headers,
					method: "GET",
					credentials: "include",
					signal: options.signal,
				}),
			);
		}

		// For failed APQ calls or mutations we need to fall back to POST requests
		if (
			!response ||
			(!isPersistedQuery(request) && hasPersistedQueryError(response))
		) {
			const url = new URL(endpoint);
			url.searchParams.append("op", request.operationName);

			// Persisted query not used or found, fall back to POST request and
			// include extension to cache the query on the server
			response = await parseResponse<GqlResponse<TResponse>>(() =>
				fetch(url.toString(), {
					headers: headers,
					method: "POST",
					body: createRequestBody(request),
					credentials: "include",
					signal: options.signal,
				}),
			);
		}

		return response;
	};

/**
 * Checks if fetch succeeded and parses the response body
 * @returns GraphQL response body
 * @param fetchFn
 */
const parseResponse = async <T>(
	fetchFn: () => Promise<Response>,
): Promise<T> => {
	const response = await fetchFn();
	invariant(
		response.ok,
		errorMessage(`Response not ok: ${response.status} ${response.statusText}`),
	);

	return (await response.json()) as T;
};
