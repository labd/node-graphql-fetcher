import { describe, expect, it } from "vitest";
import { pruneObject } from "./helpers";
import { initServerFetcher } from "./server";
import { TypedDocumentString } from "./testing";

const query = new TypedDocumentString(`
	query myQuery {
		foo
		bar
	}
`);

const hash = "e5276e0694f661ef818210402d06d249625ef169a1c2b60383acb2c42d45f7ae";
const response = { foo: "foo", bar: "bar" };
const successResponse = JSON.stringify(response);
const errorResponse = JSON.stringify({
	errors: [{ message: "PersistedQueryNotFound" }],
});

describe("gqlServerFetch", () => {
	it("should fetch a persisted query", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{ cache: "force-cache", next: { revalidate: 900 } }
		);

		const queryString = new URLSearchParams(
			pruneObject({
				operationName: "myQuery",
				variables: '{"myVar":"baz"}',
				extensions: `{"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}`,
			})
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(mockedFetch).toHaveBeenCalledWith(
			`https://localhost/graphql?${queryString}`,
			{
				method: "GET", // <- Note that for persisted queries, the method is 'GET'
				headers: {
					"Content-Type": "application/json",
				},
				cache: "force-cache",
				next: { revalidate: 900 },
			}
		);
	});

	it("should persist the query if it wasn't persisted yet", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		// Mock server saying: 'PersistedQueryNotFound'
		const mockedFetch = fetchMock
			.mockResponseOnce(errorResponse)
			.mockResponseOnce(successResponse);

		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{
				next: { revalidate: 900 },
			}
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(mockedFetch).toHaveBeenNthCalledWith(
			2,
			"https://localhost/graphql",
			{
				method: "POST", // <- Note that when persisting the query, the method is 'POST'
				body: JSON.stringify({
					operationName: "myQuery",
					query: query.toString(),
					variables: { myVar: "baz" },
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: hash,
						},
					},
				}),
				headers: {
					"Content-Type": "application/json",
				},
				cache: "default",
				next: { revalidate: 900 },
			}
		);
	});
	it("should fetch a persisted query without revalidate", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{ cache: "no-store", next: { revalidate: undefined } }
		);

		const queryString = new URLSearchParams(
			pruneObject({
				operationName: "myQuery",
				variables: '{"myVar":"baz"}',
				extensions: `{"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}`,
			})
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(mockedFetch).toHaveBeenCalledWith(
			`https://localhost/graphql?${queryString}`,
			{
				method: "GET", // <- Note that for persisted queries, the method is 'GET'
				headers: {
					"Content-Type": "application/json",
				},
				cache: "no-store",
				next: { revalidate: undefined },
			}
		);
	});

	it("should disable cache when disableCache is set", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
			dangerouslyDisableCache: true,
		});
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			// These don't have impact due to dangerouslyDisableCache
			{ cache: "force-cache", next: { revalidate: 900 } }
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(mockedFetch).toHaveBeenCalledWith("https://localhost/graphql", {
			method: "POST", // <- Note that when caching is disabled, the method is 'POST'
			body: JSON.stringify({
				operationName: "myQuery",
				query: query.toString(),
				variables: { myVar: "baz" },
			}),
			headers: {
				"Content-Type": "application/json",
			},
			cache: "no-store",
		});
	});
	// This seems as if we test fetch itself but we're actually testing whether the fetcher properly propagates the fetch errors to the package consumers
	it("should throw when JSON can't be parsed", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		fetchMock.mockResponse("<p>Not JSON</p>");

		await expect(() =>
			gqlServerFetch(query, { myVar: "baz" }, {})
		).rejects.toThrow();

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should throw when the server response is not ok", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		fetchMock.mockReject(new Error("Network error"));

		await expect(() =>
			gqlServerFetch(query, { myVar: "baz" }, {})
		).rejects.toThrow();

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
