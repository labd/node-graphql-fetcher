import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { createHash } from "@apollo/utils.createhash";

export const extractOperationName = (query: string) => {
	const matches = query.match(/(query|mutation)\s(\w+)/);
	return matches?.[2];
};

export const defaultHeaders: Record<string, string> = {
	"Content-Type": "application/json",
};

// mergeHeaders returns a new Headers object which is a combination of the
// passed headers and default headers if they are not set
export const mergeHeaders = (
	headers: Headers | Record<string, string> | undefined,
): Headers => {
	if (!headers) {
		return new Headers(defaultHeaders);
	}

	const result = new Headers(headers);
	for (const [key, value] of Object.entries(defaultHeaders)) {
		if (!result.has(key)) {
			result.append(key, value);
		}
	}
	return result;
};

export const getQueryType = (query: string): "query" | "mutation" =>
	query.trim().startsWith("query") ? "query" : "mutation";

export const getDocumentId = <TResult, TVariables>(
	query: DocumentTypeDecoration<TResult, TVariables>,
): string | undefined => (query as any)?.["__meta__"]?.["documentId"];

export type GraphQLError = {
	message: string;
	extensions: {
		code: string;
		serviceName: string;
		message?: string;
		exception?: { message: string };
	};
};

export type GqlResponse<TResponse> = {
	data: TResponse | null;
	errors: GraphQLError[] | null;
};

export interface NextFetchRequestConfig {
	revalidate?: number | false;
	tags?: string[];
}

export const pruneObject = <T>(object: T): Partial<T> => {
	const data: Record<string, unknown> = {};
	for (const key in object) {
		if (isNotEmpty(object[key])) {
			data[key] = object[key];
		}
	}
	return JSON.parse(JSON.stringify(data ?? null));
};

const isNotEmpty = (value: unknown) => value && Object.keys(value).length > 0;

// createSha256 creates a sha256 hash from a message with the same algorithm as
// Apollo Server, so we know for certain the same hash is used for automatic
// persisted queries
export const createSha256 = async (message: string) =>
	createHash("sha256").update(message).digest("hex");

/**
 * Check if the response has a PersistedQueryNotFound error.
 * @param response Fetch response object
 */
export const hasPersistedQueryError = (
	response: GqlResponse<unknown>,
): boolean =>
	Boolean(
		response?.errors?.find((item) => item.message === "PersistedQueryNotFound"),
	);

export const errorMessage = (message: string) => `graphql-fetcher: ${message}`;
