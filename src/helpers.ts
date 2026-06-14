import { createHash } from "@apollo/utils.createhash";
import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

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
	path?: (string | number)[];
	locations?: { line: number; column: number }[];
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

/**
 * Optional structured logger. All methods are optional, so a partial object
 * (or `console`) can be passed. The fetcher uses this to surface transport-level
 * conditions it would otherwise swallow -- failed requests, persisted-query
 * fallbacks, and retries. GraphQL errors returned on a 2xx are handled by
 * `onGraphQLErrors` instead, since whether they are fatal is a consumer concern.
 */
export type Logger = {
	debug?: (message: string, meta?: Record<string, unknown>) => void;
	warn?: (message: string, meta?: Record<string, unknown>) => void;
	error?: (message: string, meta?: Record<string, unknown>) => void;
};

/**
 * Identifies the request that produced an error. Shared by the terminal error
 * hooks (`onRequestError`, `onGraphQLErrors`).
 */
export type RequestContext = {
	operationName: string;
	documentId?: string;
	variables: unknown;
};

/**
 * Context passed to `onGraphQLErrors`: the request that produced the errors plus
 * the full response, so the callback can inspect partial `data` alongside the
 * errors (e.g. to tell a tolerable partial-data response from a total failure).
 */
export type GraphQLErrorContext = RequestContext & {
	/** Parsed GraphQL response -- inspect partial `data` alongside the errors. */
	response: GqlResponse<unknown>;
	/**
	 * Raw HTTP response, for status and headers (e.g. a gateway request id). Its
	 * body stream is already consumed; read `response` for the parsed payload.
	 */
	httpResponse: Response;
};

/**
 * Called when a response carries GraphQL errors (on any HTTP status), with the
 * internal `PersistedQueryNotFound` fallback signal filtered out. The library
 * takes no action of its own -- the consumer decides whether to log, ignore
 * legitimate partial-data errors, or `throw` to escalate. The callback is
 * awaited, so throwing (or returning a rejecting promise) rejects the fetch call.
 */
export type OnGraphQLErrors = (
	errors: GraphQLError[],
	context: GraphQLErrorContext,
) => void | Promise<void>;

/**
 * Called when a request fails with a thrown error -- a non-2xx response (a
 * `GraphQLFetcherError` carrying `.status`/`.body`/`.response`), or a network /
 * timeout error. Fires once, terminally, after any retries are exhausted and
 * before the error propagates. This is observation/escalation only -- it is
 * orthogonal to `retry`, which controls whether to try again. Logging is the
 * typical use; `throw` to replace the error. Not called when `onGraphQLErrors`
 * itself throws (that is a GraphQL-error escalation, not a request failure).
 */
export type OnRequestError = (
	error: unknown,
	context: RequestContext,
) => void | Promise<void>;

/**
 * Filters out the internal `PersistedQueryNotFound` signal and, if any GraphQL
 * errors remain, hands them -- with the full response -- to `onGraphQLErrors`.
 * Awaited so a throwing callback propagates.
 */
export const reportGraphQLErrors = async (
	result: GqlResponse<unknown>,
	request: RequestContext,
	httpResponse: Response,
	onGraphQLErrors?: OnGraphQLErrors,
): Promise<void> => {
	if (!onGraphQLErrors) {
		return;
	}

	const errors = result.errors?.filter(
		(error) => error.message !== "PersistedQueryNotFound",
	);
	if (errors?.length) {
		await onGraphQLErrors(errors, {
			...request,
			response: result,
			httpResponse,
		});
	}
};

/**
 * Hands a thrown request error to `onRequestError`, if set. Awaited so a
 * throwing callback (which replaces the error) propagates.
 */
export const reportRequestError = async (
	error: unknown,
	request: RequestContext,
	onRequestError?: OnRequestError,
): Promise<void> => {
	if (onRequestError) {
		await onRequestError(error, request);
	}
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
