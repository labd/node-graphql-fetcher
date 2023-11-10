import invariant from "tiny-invariant";
import type { GqlResponse, TypedDocumentString } from "./helpers";
import { createSha256, defaultHeaders, extractOperationName } from "./helpers";

type beforeRequestFn = () => Promise<void>;

type Options = {
	beforeRequest?: beforeRequestFn;
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: TypedDocumentString<TResponse, TVariables>,
	variables?: TVariables
) => Promise<GqlResponse<TResponse>>;

export const initClientFetcher =
	(endpoint: string, { beforeRequest }: Options = {}): ClientFetcher =>
	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all user information is only
	 * used after rendering the page for caching reasons.
	 *
	 * There is no APQ being used since these queries often contain user information.
	 */
	async <TResponse, TVariables>(
		astNode: TypedDocumentString<TResponse, TVariables>,
		variables?: TVariables
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();
		const operationName = extractOperationName(query);

		const hash =
			astNode?.["__meta__"]?.["hash"] ?? (await createSha256(query).toString());

		const extensions = {
			persistedQuery: {
				version: 1,
				sha256Hash: hash,
			},
		};

		// Run before hooks
		if (beforeRequest) {
			await beforeRequest();
		}

		const response = await fetch(`${endpoint}?op=${operationName}`, {
			headers: defaultHeaders,
			method: "POST",
			body: JSON.stringify({ query, variables, extensions }),
			credentials: "include",
		});

		invariant(
			response.ok,
			`Response not ok: ${response.status} ${response.statusText}`
		);

		const body = await response
			.json()
			.catch((err) => invariant(false, "Could not parse JSON from response"));

		// Check for GraphQL errors
		const hasErrors = body.errors?.length && body.errors.length > 0;
		invariant(hasErrors, JSON.stringify(body.errors, null, 2));

		return body;
	};
