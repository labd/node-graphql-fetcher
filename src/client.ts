import type { GqlResponse, TypedDocumentString } from "./helpers";
import {
	createSha256,
	defaultHeaders,
	extractOperationName,
	handleResponse,
	hasPersistedQueryError,
} from "./helpers";
import PQueue from "p-queue";

type beforeRequestFn = () => Promise<void>;

type Options = {
	beforeRequest?: beforeRequestFn;
	persisted?: boolean;
};

type FetcherOptions = {
	queueName?: string;
};

export type ClientFetcher = <TResponse, TVariables>(
	astNode: TypedDocumentString<TResponse, TVariables>,
	variables?: TVariables,
	options?: FetcherOptions
) => Promise<GqlResponse<TResponse>>;

const queueMap = new Map<string, PQueue>();

const getQueue = (name: string) => {
	if (!queueMap.has(name)) {
		queueMap.set(name, new PQueue({ concurrency: 1 }));
	}
	return queueMap.get(name);
};

export const initClientFetcher = (
	endpoint: string,
	{ beforeRequest, persisted }: Options = {}
): ClientFetcher => {
	const fetchAndHandleResponse = async <TResponse, TVariables>(
		endpoint: string,
		astNode: TypedDocumentString<TResponse, TVariables>,
		variables?: TVariables
	) => {
		const query = astNode.toString();
		const operationName = extractOperationName(query);

		let hash = "";
		let extensions = {};
		if (persisted) {
			hash = astNode?.["__meta__"]?.["hash"] ?? (await createSha256(query));

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

		if (persisted) {
			// Do persisted query
			const response = await fetch(`${endpoint}?op=${operationName}`, {
				headers: defaultHeaders,
				method: "GET",
				body: JSON.stringify({ variables, extensions }),
				credentials: "include",
			});

			// Only handleResponse and return if the server can handle the APQ
			const hasError = await hasPersistedQueryError(response);

			if (!hasError) {
				return handleResponse(response);
			}
		}

		const response = await fetch(`${endpoint}?op=${operationName}`, {
			headers: defaultHeaders,
			method: "POST",
			body: JSON.stringify({ query, variables, extensions }),
			credentials: "include",
		});

		return handleResponse(response);
	};

	/**
	 * Executes a GraphQL query post request on the client.
	 *
	 * This is the only fetcher that uses user information in the call since all user information is only
	 * used after rendering the page for caching reasons.
	 *
	 * There is no APQ being used since these queries often contain user information.
	 */
	return async <TResponse, TVariables>(
		astNode: TypedDocumentString<TResponse, TVariables>,
		variables?: TVariables,
		options?: FetcherOptions
	): Promise<GqlResponse<TResponse>> => {
		if (options?.queueName) {
			const queue = getQueue(options.queueName);
			return queue?.add(() =>
				fetchAndHandleResponse(endpoint, astNode, variables)
			);
		}
		return fetchAndHandleResponse(endpoint, astNode, variables);
	};
};
