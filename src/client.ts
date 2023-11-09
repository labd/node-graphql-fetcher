import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import type { GqlResponse } from "./helpers";
import { defaultHeaders, extractOperationName } from "./helpers";

type beforeRequestFn = () => Promise<void>;

export type ClientFetcher = <TResponse, TVariables>(
	astNode: DocumentTypeDecoration<TResponse, TVariables>,
	variables?: TVariables
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher = (
	endpoint: string,
	beforeRequestFn?: beforeRequestFn
): ClientFetcher => {
	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all user information is only
	 * used after rendering the page for caching reasons.
	 *
	 * There is no APQ being used since these queries often contain user information.
	 */
	return async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables?: TVariables
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();
		const operationName = extractOperationName(query);

		// Run before hooks
		if (beforeRequestFn) {
			await beforeRequestFn();
		}

		const response = await fetch(`${endpoint}?op=${operationName}`, {
			headers: defaultHeaders,
			method: "POST",
			body: JSON.stringify({ query, variables }),
			credentials: "include",
		}).then<GqlResponse<TResponse>>((r) => r.json());

		if (response.errors?.length) {
			throw new Error(JSON.stringify(response.errors, null, 2));
		}

		return response;
	};
};
