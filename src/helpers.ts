import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

export const extractOperationName = (query: string) => {
	const matches = query.match(/(query|mutation)\s(\w+)/);
	return matches?.[2];
};

export const defaultHeaders: Record<string, string> = {
	"Content-Type": "application/json",
};

export const getQueryType = (query: string) =>
	query.trim().startsWith("query") ? "query" : "mutation";

export const getQueryHash = <TResult, TVariables>(
	query: DocumentTypeDecoration<TResult, TVariables>
) => (query as any)?.["__meta__"]?.["hash"];

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
export const hasPersistedQueryError = async <T>(response: Response) => {
	if (!response.ok) return false;

	try {
		// Clone response as we can only read the body once, and it will also be read later on in the flow
		// TODO: Optimise this flow as you always parse the response twice now when persisted queries are enabled
		const body = (await response.clone().json()) as GqlResponse<T>;

		return Boolean(
			body?.errors?.find((item) => item.message === "PersistedQueryNotFound")
		);
	} catch (err) {
		return false;
	}
};

export const errorMessage = (message: string) => `graphql-fetcher: ${message}`;
