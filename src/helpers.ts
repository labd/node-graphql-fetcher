import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import invariant from "tiny-invariant";

export const extractOperationName = (query: string) => {
	const matches = query.match(/(query|mutation)\s(\w+)/);
	return matches?.[2];
};

export const defaultHeaders: Record<string, string> = {
	"Content-Type": "application/json",
};

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

export class TypedDocumentString<TResult, TVariables>
	extends String
	implements DocumentTypeDecoration<TResult, TVariables>
{
	__apiType?: DocumentTypeDecoration<TResult, TVariables>["__apiType"];

	constructor(private value: string, public __meta__?: Record<string, any>) {
		super(value);
	}

	toString(): string & DocumentTypeDecoration<TResult, TVariables> {
		return this.value;
	}
}

/**
 * Prefix for error messages
 */
export const createErrorPrefix = (...args: any[]) =>
	["Error in query:", ...args].join("\n");

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
 * Helper function that parses the response body and returns the data or throws an error
 * @param response Fetch response object
 * @returns GraphQL response body
 */
export const handleResponse = async (response: Response) => {
	invariant(
		response.ok,
		`Response not ok: ${response.status} ${response.statusText}`
	);
	const body = await response
		.json()
		.catch((err) =>
			invariant(false, "Could not parse JSON from response: " + err)
		);

	// Check for GraphQL errors
	const hasNoErrors = !(body.errors?.length && body.errors.length > 0);
	invariant(hasNoErrors, JSON.stringify(body.errors, null, 2));

	return body;
};

/**
 * Check if the response has a PersistedQueryNotFound error.
 * @param response Fetch response object
 */
export const hasPersistedQueryError = async <T>(response: Response) => {
	if (!response.ok) return false;

	try {
		const body = (await response.json()) as GqlResponse<T>;

		return Boolean(
			body?.errors?.find((item) => item.message === "PersistedQueryNotFound")
		);
	} catch (err) {
		return false;
	}
};
