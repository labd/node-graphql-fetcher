import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import invariant from "tiny-invariant";
import type { GqlResponse } from "./helpers";
import {
	createSha256,
	defaultHeaders,
	errorMessage,
	extractOperationName,
	getQueryHash,
	getQueryType,
	hasPersistedQueryError,
} from "./helpers";

type Options = {
	/**
	 * Enable use of persisted queries, this will always add a extra roundtrip to the server if queries aren't cacheable
	 * @default false
	 */
	persistedQueries?: boolean;
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher =
	(
		endpoint: string,
		{ persistedQueries = false }: Options = {}
	): ClientFetcher =>
	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all user information is only
	 * used after rendering the page for caching reasons.
	 */
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables?: TVariables
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();

		const operationName = extractOperationName(query);

		let hash = "";
		let extensions = {};
		if (persistedQueries) {
			hash = getQueryHash(astNode) ?? (await createSha256(query));

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

		// For queries we can use GET requests if persisted queries are enabled
		if (persistedQueries && getQueryType(query) === "query") {
			url.searchParams.set("extensions", JSON.stringify(extensions));
			if (variables) {
				url.searchParams.set("variables", JSON.stringify(variables));
			}
			response = await parseResponse<GqlResponse<TResponse>>(() =>
				fetch(url.toString(), {
					headers: defaultHeaders,
					method: "GET",
					credentials: "include",
				})
			);
		}

		// TODO: Optimise this flow as you always parse the response twice now when persisted queries are enabled
		if (!response || hasPersistedQueryError(response)) {
			// Persisted query not used or found, fall back to POST request and include extension to cache the query on the server
			response = await parseResponse<GqlResponse<TResponse>>(() =>
				fetch(url.toString(), {
					headers: defaultHeaders,
					method: "POST",
					body: JSON.stringify({ query, variables, extensions }),
					credentials: "include",
				})
			);
		}

		return response;
	};

/**
 * Checks if fetch succeeded and parses the response body
 * @param response Fetch response object
 * @returns GraphQL response body
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
