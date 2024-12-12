import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

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
	headers: Headers | Record<string, string> | undefined
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

export const getQueryType = (query: string) =>
	query.trim().startsWith("query") ? "query" : "mutation";

export const getDocumentId = <TResult, TVariables>(
	query: DocumentTypeDecoration<TResult, TVariables>
): string | undefined => (query as any)?.["__meta__"]?.["hash"];

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

export const pruneObject = <T>(object: T): Partial<T> =>
	JSON.parse(JSON.stringify(object ?? null));

/**
 * Simple wrapper to create a SHA256 hash with subtle crypto
 * @param message Message to hash
 */
export const createSha256 = async (message: string) => {
	const hash = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(message)
	);

	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
};

/**
 * Check if the response has a PersistedQueryNotFound error.
 * @param response Fetch response object
 */
export const hasPersistedQueryError = (
	response: GqlResponse<unknown>
): boolean =>
	Boolean(
		response?.errors?.find((item) => item.message === "PersistedQueryNotFound")
	);

export const errorMessage = (message: string) => `graphql-fetcher: ${message}`;
