import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { createSha256, extractOperationName, pruneObject } from "helpers";

export type ModeFlags = "persisted" | "document" | "both";

export type DocumentIdFn = <TResult, TVariables>(
	query: DocumentTypeDecoration<TResult, TVariables>,
) => string | undefined;

export type GraphQLRequest<TVariables> = {
	mode: ModeFlags;
	operationName: string;
	query: string | undefined;
	documentId: string | undefined;
	variables: TVariables | undefined;
	extensions: Record<string, unknown>;
};

export const isPersistedQuery = <T>(request: GraphQLRequest<T>): boolean =>
	request.mode === "persisted" || request.mode === "both";

export const createRequestSearchParams = <TVariables>(
	request: GraphQLRequest<TVariables>,
) => {
	let params: Record<string, string> = {
		op: request.operationName,
	};

	if (request.mode === "both" || request.mode === "persisted") {
		if (!request.documentId) {
			throw new Error("Persisted query mode requires a documentId");
		}
		params.documentId = request.documentId;
	}

	params = {
		...params,
		...pruneObject({
			variables: isNotEmpty(request.variables)
				? JSON.stringify(request.variables)
				: undefined,
			extensions: isNotEmpty(request.extensions)
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
	switch (request.mode) {
		case "both":
			return JSON.stringify(
				pruneObject({
					documentId: request.documentId,
					query: request.query,
					variables: request.variables,
					extensions: request.extensions,
				}),
			);
		case "document":
			return JSON.stringify(
				pruneObject({
					query: request.query,
					variables: request.variables,
					extensions: request.extensions,
				}),
			);
		case "persisted":
			if (!request.documentId) {
				throw new Error("Persisted query mode requires a documentId");
			}
			return JSON.stringify(
				pruneObject({
					documentId: request.documentId,
					variables: request.variables,
					extensions: request.extensions,
				}),
			);
	}
};

export const createRequest = async <TVariables>(
	mode: ModeFlags,
	query: string,
	variables: TVariables,
	documentId?: string,
): Promise<GraphQLRequest<TVariables>> => {
	const operationName = extractOperationName(query) || "(GraphQL)";

	const request = {
		mode,
		documentId,
		query,
		operationName,
		variables,
		extensions: {},
	};

	/**
	 * Replace full queries with generated ID's to reduce bandwidth.
	 * @see https://www.apollographql.com/docs/react/api/link/persisted-queries/#protocol
	 *
	 * Note that these are not the same hashes as the documentId, which is
	 * used for allowlisting of query documents
	 */
	if (mode === "document" || mode === "both") {
		request.extensions = {
			persistedQuery: {
				version: 1,
				sha256Hash: await createSha256(query),
			},
		};
	}
	return request;
};
