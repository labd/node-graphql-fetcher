import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import invariant from "tiny-invariant";
import { getDocumentId, GqlResponse } from "./helpers";
import {
	createSha256,
	errorMessage,
	extractOperationName,
	getQueryType,
	hasPersistedQueryError,
	mergeHeaders,
} from "./helpers";
import { print } from "graphql";
import { isNode } from "graphql/language/ast.js";

type Options = {
	/**
	 * Enable use of persisted queries, this will always add a extra roundtrip to the server if queries aren't cacheable
	 * @default false
	 */
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
	 * Function to customize creating the documentId from a query
	 *
	 * @param query
	 */
	createDocumentId?: <TResult, TVariables>(
		query: DocumentTypeDecoration<TResult, TVariables>
	) => string | undefined;
};

type RequestOptions = {
	signal?: AbortSignal;
	headers?: Headers | Record<string, string>;
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables,
	options?: RequestOptions | AbortSignal // Backwards compatibility
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher =
	(
		endpoint: string,
		{
			persistedQueries = false,
			defaultTimeout = 30000,
			defaultHeaders = {},
			createDocumentId = <TResult, TVariables>(
				query: DocumentTypeDecoration<TResult, TVariables>
			): string | undefined => getDocumentId(query),
		}: Options = {}
	): ClientFetcher =>
	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all user information is only
	 * used after rendering the page for caching reasons.
	 */
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables?: TVariables,
		optionsOrSignal: RequestOptions | AbortSignal = {
			signal: AbortSignal.timeout(defaultTimeout),
		} satisfies RequestOptions
	): Promise<GqlResponse<TResponse>> => {
		// For backwards compatibility, when options is an AbortSignal we transform
		// it into a RequestOptions object
		const options: RequestOptions = {};
		if (optionsOrSignal instanceof AbortSignal) {
			options.signal = optionsOrSignal;
		} else {
			Object.assign(options, optionsOrSignal);
		}

		// Make sure that we always have a default signal set
		if (!options.signal) {
			options.signal = AbortSignal.timeout(defaultTimeout);
		}

		const query = isNode(astNode) ? print(astNode) : astNode.toString();

		const operationName = extractOperationName(query);
		const documentId = createDocumentId(astNode);

		let extensions = {};
		if (persistedQueries) {
			const hash = await createSha256(query);

			extensions = {
				persistedQuery: {
					version: 1,
					sha256Hash: hash,
				},
			};
		}

		const url = new URL(endpoint);
		url.searchParams.set("op", operationName ?? "");

		let response: GqlResponse<TResponse> | undefined = undefined;

		const headers = mergeHeaders({ ...defaultHeaders, ...options.headers });

		// For queries we can use GET requests if persisted queries are enabled
		if (persistedQueries && getQueryType(query) === "query") {
			url.searchParams.set("extensions", JSON.stringify(extensions));
			if (variables) {
				url.searchParams.set("variables", JSON.stringify(variables));
			}
			if (documentId) {
				url.searchParams.set("documentId", documentId);
			}
			response = await parseResponse<GqlResponse<TResponse>>(() =>
				fetch(url.toString(), {
					headers: Object.fromEntries(headers.entries()),
					method: "GET",
					credentials: "include",
					signal: options.signal,
				})
			);
		}

		if (!response || hasPersistedQueryError(response)) {
			// Persisted query not used or found, fall back to POST request and include extension to cache the query on the server
			response = await parseResponse<GqlResponse<TResponse>>(() =>
				fetch(url.toString(), {
					headers: Object.fromEntries(headers.entries()),
					method: "POST",
					body: JSON.stringify({ documentId, query, variables, extensions }),
					credentials: "include",
					signal: options.signal,
				})
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
	fetchFn: () => Promise<Response>
): Promise<T> => {
	const response = await fetchFn();
	invariant(
		response.ok,
		errorMessage(`Response not ok: ${response.status} ${response.statusText}`)
	);

	return (await response.json()) as T;
};
