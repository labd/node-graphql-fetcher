import { describe, expect, it } from "vitest";
import { TypedDocumentString, pruneObject } from "./helpers";
import { initServerFetcher } from "./server";

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
	const gqlServerFetch = initServerFetcher("https://localhost/graphql");

	it("should fetch a persisted query", async () => {
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(query, { myVar: "baz" }, false, {
			revalidate: 900,
		});

		const queryString = new URLSearchParams(
			pruneObject({
				operationName: "myQuery",
				variables: '{"myVar":"baz"}',
				extensions: `{"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}`,
			}),
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
				next: { revalidate: 900 },
			},
		);
	});

	it("should persist the query if it wasn't persisted yet", async () => {
		// Mock server saying: 'PersistedQueryNotFound'
		const mockedFetch = fetchMock
			.mockResponseOnce(errorResponse)
			.mockResponseOnce(successResponse);

		const gqlResponse = await gqlServerFetch(query, { myVar: "baz" }, false, {
			revalidate: 900,
		});

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
				next: { revalidate: 900 },
			},
		);
	});
	it("should fetch a persisted query without revalidate", async () => {
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(query, { myVar: "baz" }, false);

		const queryString = new URLSearchParams(
			pruneObject({
				operationName: "myQuery",
				variables: '{"myVar":"baz"}',
				extensions: `{"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}`,
			}),
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
			},
		);
	});

	it("should not persist query when in draftmode", async () => {
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(query, { myVar: "baz" }, true, {
			revalidate: 900,
			tags: ["my-tag"],
		});

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(mockedFetch).toHaveBeenCalledWith(`https://localhost/graphql`, {
			method: "POST", // <- Note that for persisted queries, the method is 'GET'
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				operationName: "myQuery",
				query: query.toString(),
				variables: { myVar: "baz" },
			}),
			cache: "no-store",
			next: { revalidate: undefined, tags: ["my-tag"] },
		});
	});
});
