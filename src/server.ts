import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import type { GqlResponse, NextFetchRequestConfig } from "./helpers";
import { trace } from "@opentelemetry/api";
import {
	createSha256,
	defaultHeaders,
	extractOperationName,
	getQueryHash,
	pruneObject,
} from "./helpers";

type Options = {
	disableCache?: boolean;
};

// TODO: make version dynamic, or part of the release process
const tracer = trace.getTracer("@labdigital/graphql-fetcher", "0.3.0");

export const initServerFetcher =
	(url: string, options?: Options) =>
	/**
	 * Replace full queries with generated ID's to reduce bandwidth.
	 * @see https://www.apollographql.com/docs/react/api/link/persisted-queries/#protocol
	 */
	async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		cache: RequestCache = "force-cache",
		next: NextFetchRequestConfig = {}
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();
		const operationName = extractOperationName(query) || "(GraphQL)";

		if (options?.disableCache) {
			return tracer.startActiveSpan(operationName, async (span) =>
				gqlPost<TResponse>(
					url,
					JSON.stringify({ operationName, query, variables }),
					"no-store",
					{ ...next, revalidate: 0 }
				).finally(() => {
					span.end();
				})
			);
		}

		const extensions = {
			persistedQuery: {
				version: 1,
				sha256Hash: getQueryHash(astNode) ?? (await createSha256(query)),
			},
		};

		// Otherwise, try to get the cached query
		return tracer.startActiveSpan(operationName, async (span) =>
			gqlPersistedQuery<TResponse>(
					url,
					getQueryString(operationName, variables, extensions),
					cache,
					next
				)
					.then((response) => {
						// If it doesn't exist, do a POST request anyway and cache it.
						if (response.errors?.[0]?.message === "PersistedQueryNotFound") {
							return gqlPost<TResponse>(
								url,
								JSON.stringify({ operationName, query, variables, extensions }),
								cache,
								next
							);
						}
						return response;
					})
					.finally(() => {
						span.end();
					})
		);
	};

const gqlPost = <T>(
	url: string,
	body: string,
	cache: RequestCache,
	next?: NextFetchRequestConfig
) =>
	fetch(url, {
		headers: defaultHeaders,
		method: "POST",
		body,
		cache,
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		next,
	})
		.then<GqlResponse<T>>((response) => response.json())
		.then((response) => {
			if (response.errors?.length) {
				throw new Error(JSON.stringify(response.errors, null, 2));
			}
			return response;
		});

const gqlPersistedQuery = <T>(
	url: string,
	queryString: URLSearchParams,
	cache: RequestCache,
	next?: NextFetchRequestConfig
) =>
	fetch(`${url}?${queryString}`, {
		method: "GET",
		headers: defaultHeaders,
		cache,
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		next,
	}).then<GqlResponse<T>>((response) => response.json());

const getQueryString = <TVariables>(
	operationName: string | undefined,
	variables: TVariables | undefined,
	extensions: { persistedQuery: { version: number; sha256Hash: string } }
) =>
	new URLSearchParams(
		pruneObject({
			operationName,
			variables: JSON.stringify(variables),
			extensions: JSON.stringify(extensions),
		})
	);
