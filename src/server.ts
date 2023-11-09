import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";
import { pruneObject } from "./helpers";
import sha256 from "crypto-js/sha256";
import type { GqlResponse, NextFetchRequestConfig } from "./helpers";
import { defaultHeaders, extractOperationName } from "./helpers";

export class ServerFetcher {
	constructor(private endpoint: string) {}

	/**
	 * Replace full queries with generated ID's to reduce bandwidth.
	 * @see https://www.apollographql.com/docs/react/api/link/persisted-queries/#protocol
	 */
	async fetch<TResponse, TVariables>(
		astNode: DocumentTypeDecoration<TResponse, TVariables>,
		variables: TVariables,
		draftModeEnabled = false,
		next: NextFetchRequestConfig = {}
	): Promise<GqlResponse<TResponse>> {
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
			return this.gqlPost<TResponse>(
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
		const response = await this.gqlPersistedQuery<TResponse>(
			getQueryString(operationName, variables, extensions),
			cache,
			next
		);

		// If it doesn't exist, do a POST request anyway and cache it.
		if (response.errors?.[0]?.message === "PersistedQueryNotFound") {
			return this.gqlPost<TResponse>(
				JSON.stringify({ operationName, query, variables, extensions }),
				errorPrefix,
				cache,
				next
			);
		}

		return response;
	}

	private gqlPost<T>(
		body: string,
		errorPrefix?: string,
		cache?: RequestCache,
		next?: NextFetchRequestConfig
	) {
		return fetch(this.endpoint, {
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
	}

	private gqlPersistedQuery<T>(
		queryString: URLSearchParams,
		cache?: RequestCache,
		next?: NextFetchRequestConfig
	) {
		return fetch(`${this.endpoint}?${queryString}`, {
			method: "GET",
			headers: defaultHeaders,
			cache,
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-ignore
			next,
		}).then<GqlResponse<T>>((response) => response.json());
	}
}

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
