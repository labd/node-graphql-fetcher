import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { pruneObject } from "./helpers";
import sha256 from "crypto-js/sha256";
import type { GqlResponse, NextFetchRequestConfig } from "./helpers";
import { defaultHeaders, extractOperationName } from "./helpers";

export const initServerFetcher = (url: string) => {
	/**
	 * Replace full queries with generated ID's to reduce bandwidth.
	 * @see https://www.apollographql.com/docs/react/api/link/persisted-queries/#protocol
	 */
	return async <TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		draftModeEnabled = false,
		next: NextFetchRequestConfig = {}
	): Promise<GqlResponse<TResponse>> => {
		const query = astNode.toString();
		const operationName = extractOperationName(query);

		const errorPrefix = draftModeEnabled
			? [
					"ERROR IN QUERY:",
					operationName,
					JSON.stringify(variables, null, 2),
			  ].join("\n")
			: undefined;

		// If draft mode has been enabled, skip the APQ, skip data-cache and do a regular POST request
		if (draftModeEnabled) {
			return gqlPost<TResponse>(
				url,
				JSON.stringify({ operationName, query, variables }),
				errorPrefix,
				"no-store",
				{ ...next, revalidate: undefined }
			);
		}

		// Disable cache when revalidate is not set
		const cache = next.revalidate === undefined ? "no-store" : undefined;
		const extensions = {
			persistedQuery: { version: 1, sha256Hash: sha256(query).toString() },
		};

		// Otherwise, try to get the cached query
		const response = await gqlPersistedQuery<TResponse>(
			url,
			getQueryString(operationName, variables, extensions),
			cache,
			next
		);

		// If it doesn't exist, do a POST request anyway and cache it.
		if (response.errors?.[0]?.message === "PersistedQueryNotFound") {
			return gqlPost<TResponse>(
				url,
				JSON.stringify({ operationName, query, variables, extensions }),
				errorPrefix,
				cache,
				next
			);
		}

		return response;
	};
};

const gqlPost = <T>(
	url: string,
	body: string,
	errorPrefix?: string,
	cache?: RequestCache,
	next?: NextFetchRequestConfig
) => {
	return fetch(url, {
		headers: defaultHeaders,
		method: "POST",
		cache,
		body,
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		next,
	})
		.then<GqlResponse<T>>((response) => response.json())
		.then((response) => {
			if (response.errors?.length) {
				// log errors in draft mode
				if (errorPrefix) {
					console.error(errorPrefix, response.errors);
				} else {
					// Otherwise throw them errors
					throw new Error(
						[errorPrefix, JSON.stringify(response.errors, null, 2)].join("\n")
					);
				}
			}
			return response;
		});
};

const gqlPersistedQuery = <T>(
	url: string,
	queryString: URLSearchParams,
	cache?: RequestCache,
	next?: NextFetchRequestConfig
) => {
	return fetch(`${url}?${queryString}`, {
		method: "GET",
		headers: defaultHeaders,
		cache,
		// eslint-disable-next-line @typescript-eslint/ban-ts-comment
		// @ts-ignore
		next,
	}).then<GqlResponse<T>>((response) => response.json());
};

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
