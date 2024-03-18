import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import invariant from "tiny-invariant";
import type { GqlResponse } from "./helpers";
import {
	createSha256,
	defaultHeaders,
	extractOperationName,
	getQueryHash,
	getQueryType,
	hasPersistedQueryError,
} from "./helpers";

type RequestEventFn = () => Promise<void>;

type Options = {
	onBeforeRequest?: RequestEventFn;
	persisted?: boolean;
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher =
	(
		endpoint: string,
		{ onBeforeRequest, persisted }: Options = {}
	): ClientFetcher =>
	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all user information is only
	 * used after rendering the page for caching reasons.
	 *
	 * There is no APQ being used since these queries often contain user information.
	 */
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables?: TVariables
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();

		const operationName = extractOperationName(query);

		let hash = "";
		let extensions = {};
		if (persisted) {
			hash = getQueryHash(astNode) ?? (await createSha256(query));

			extensions = {
				persistedQuery: {
					version: 1,
					sha256Hash: hash,
				},
			};
		}

		// TODO: Not sure if we want this single event function if it can also be run before running the fetcher
		if (onBeforeRequest) {
			await onBeforeRequest();
		}

		const url = new URL(endpoint);
		url.searchParams.set("op", operationName ?? "");

		// For queries we can use GET requests if APQ is enabled
		if (persisted && getQueryType(query) === "query") {
			url.searchParams.set("extensions", JSON.stringify(extensions));
			if (variables) {
				url.searchParams.set("variables", JSON.stringify(variables));
			}
			const response = await fetch(url.toString(), {
				headers: defaultHeaders,
				method: "GET",
				credentials: "include",
			});

			// Only handleResponse and return if the server can handle the persisted query
			if (!(await hasPersistedQueryError(response))) {
				return handleResponse(response);
			}
		}

		// Fallback to post request
		const response = await fetch(url.toString(), {
			headers: defaultHeaders,
			method: "POST",
			body: JSON.stringify({ query, variables, extensions }),
			credentials: "include",
		});

		return handleResponse(response);
	};

/**
 * Checks if fetch succeeded and body is JSON-parseable, otherwise throws an error.
 *
 * Any additional checks (GraphQL errors, etc.) should be done in the calling function
 * @param response Fetch response object
 * @returns GraphQL response body
 */
const handleResponse = async (response: Response) => {
	invariant(
		response.ok,
		`Response not ok: ${response.status} ${response.statusText}`
	);

	const body = await response
		.json()
		.catch((err) => invariant(false, "Could not parse JSON from response"));

	return body;
};
