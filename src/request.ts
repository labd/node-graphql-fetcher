import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { createSha256, extractOperationName, pruneObject } from "helpers";

export type DocumentIdFn = <TResult, TVariables>(
	query: DocumentTypeDecoration<TResult, TVariables>,
) => string | undefined;

export type GraphQLRequest<TVariables> = {
	operationName: string;
	query: string | undefined;
	documentId: string | undefined;
	variables: TVariables | undefined;
	extensions: Record<string, unknown>;
	includeQuery: boolean;
};

export const isPersistedQuery = <TVariables>(
	request: GraphQLRequest<TVariables>,
) => {
	return request.documentId !== undefined;
};

export const createRequestSearchParams = <TVariables>(
	request: GraphQLRequest<TVariables>,
) => {
	let params: Record<string, string> = {
		op: request.operationName,
	};

	params = {
		...params,
		...pruneObject({
			documentId: request.documentId,
			variables: isNotEmpty(request.variables)
				? JSON.stringify(request.variables)
				: undefined,
			extensions:
				isNotEmpty(request.extensions) &&
				(!request.documentId || request.includeQuery)
					? JSON.stringify(request.extensions)
					: undefined,
		}),
	};
	return new URLSearchParams(params);
};

const isNotEmpty = (value: unknown) => value && Object.keys(value).length > 0;

export const createRequestURL = <TVariables>(
	url: string,
	request: GraphQLRequest<TVariables>,
): URL => {
	const result = new URL(url);
	const qs = createRequestSearchParams(request);
	for (const [key, value] of qs) {
		if (value) {
			result.searchParams.append(key, value);
		}
	}
	return result;
};

export const createRequestBody = <TVariables>(
	request: GraphQLRequest<TVariables>,
) => {
	if (!request.documentId || request.includeQuery) {
		return JSON.stringify(
			pruneObject({
				documentId: request.documentId,
				query: request.query,
				variables: request.variables,
				extensions: request.extensions,
			}),
		);
	}
	return JSON.stringify(
		pruneObject({
			documentId: request.documentId,
			variables: request.variables,
			extensions: request.extensions,
		}),
	);
};

export const createRequest = async <TVariables>(
	query: string,
	variables: TVariables,
	documentId?: string,
	includeQuery?: boolean,
): Promise<GraphQLRequest<TVariables>> => {
	const operationName = extractOperationName(query) || "(GraphQL)";

	const request = {
		documentId,
		query,
		operationName,
		variables,
		extensions: {},
		includeQuery: includeQuery ?? false,
	};

	/**
	 * Replace full queries with generated ID's to reduce bandwidth.
	 * @see https://www.apollographql.com/docs/react/api/link/persisted-queries/#protocol
	 *
	 * Note that these are not the same hashes as the documentId, which is
	 * used for allowlisting of query documents
	 */
	if (!documentId || request.includeQuery) {
		request.extensions = {
			persistedQuery: {
				version: 1,
				sha256Hash: await createSha256(query),
			},
		};
	}
	return request;
};
