import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import type { GqlResponse } from "./helpers";
import {
	createSha256,
	defaultHeaders,
	extractOperationName,
	getQueryHash,
	getQueryType,
	handleResponse as defaultHandleResponse,
	hasPersistedQueryError,
} from "./helpers";

type beforeRequestFn = () => Promise<void>;
type handleResponseFn = (response: Response) => Promise<any>;

type Options = {
	beforeRequest?: beforeRequestFn;
	persisted?: boolean;
	handleResponse?: handleResponseFn;
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher =
	(
		endpoint: string,
		{ beforeRequest, persisted, handleResponse }: Options = {}
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

		// Run before hooks
		if (beforeRequest) {
			await beforeRequest();
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

			// Only handleResponse and return if the server can handle the APQ
			const hasError = await hasPersistedQueryError(response);

			if (!hasError) {
				return responseHandler(response, handleResponse);
			}
		}

		const response = await fetch(url.toString(), {
			headers: defaultHeaders,
			method: "POST",
			body: JSON.stringify({ query, variables, extensions }),
			credentials: "include",
		});

		return responseHandler(response, handleResponse);
	};

const responseHandler = (
	response: Response,
	handleResponse?: handleResponseFn
) => {
	if (handleResponse) {
		return handleResponse(response);
	}
	return defaultHandleResponse(response);
};
