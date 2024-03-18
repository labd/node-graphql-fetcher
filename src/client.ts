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

		let response: Response | undefined = undefined;

		// For queries we can use GET requests if persisted queries are enabled
		if (persisted && getQueryType(query) === "query") {
			url.searchParams.set("extensions", JSON.stringify(extensions));
			if (variables) {
				url.searchParams.set("variables", JSON.stringify(variables));
			}
			response = await fetch(url.toString(), {
				headers: defaultHeaders,
				method: "GET",
				credentials: "include",
			});
		}

		if (!response || (await hasPersistedQueryError(response))) {
			// Persisted query not used or found, fall back to POST request and include extension to cache the query on the server
			response = await fetch(url.toString(), {
				headers: defaultHeaders,
				method: "POST",
				body: JSON.stringify({ query, variables, extensions }),
				credentials: "include",
			});
		}

		invariant(
			response.ok,
			errorMessage(`Response not ok: ${response.status} ${response.statusText}`)
		);

		return (await response.json()) as GqlResponse<TResponse>;
	};
