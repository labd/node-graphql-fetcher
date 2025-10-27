import { describe, expect, it, vi } from "vitest";
import { createSha256, pruneObject } from "./helpers";
import { initServerFetcher } from "./server";
import { TypedDocumentString } from "./testing";

const query = new TypedDocumentString(`
	query myQuery {
		foo
		bar
	}
`);
const queryMutation = new TypedDocumentString(`
	mutation myMutation {
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
		const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
			apq: true,
		});
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{ cache: "force-cache", next: { revalidate: 900 } },
		);

		const queryString = new URLSearchParams(
			pruneObject({
				op: "myQuery",
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
				headers: new Headers({
					"Content-Type": "application/json",
				}),
				cache: "force-cache",
				next: { revalidate: 900 },
			},
		);
	});

	it("should persist the query if it wasn't persisted yet", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
			apq: true,
		});
		// Mock server saying: 'PersistedQueryNotFound'
		const mockedFetch = fetchMock
			.mockResponseOnce(errorResponse)
			.mockResponseOnce(successResponse);

		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{
				next: { revalidate: 900 },
			},
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(mockedFetch).toHaveBeenNthCalledWith(
			2,
			"https://localhost/graphql?op=myQuery",
			{
				method: "POST", // <- Note that when persisting the query, the method is 'POST'
				body: JSON.stringify({
					query: query.toString(),
					variables: { myVar: "baz" },
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: await createSha256(query.toString()),
						},
					},
				}),
				headers: new Headers({
					"Content-Type": "application/json",
				}),
				next: { revalidate: 900 },
			},
		);
	});

	it("should skip persisted queries if operation is a mutation", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		const mockedFetch = fetchMock.mockResponseOnce(successResponse);

		const gqlResponse = await gqlServerFetch(
			queryMutation,
			{ myVar: "baz" },
			{
				next: { revalidate: 900 },
			},
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(mockedFetch).toHaveBeenNthCalledWith(
			1,
			"https://localhost/graphql?op=myMutation",
			{
				method: "POST",
				body: JSON.stringify({
					query: queryMutation.toString(),
					variables: { myVar: "baz" },
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: await createSha256(queryMutation.toString()),
						},
					},
				}),
				headers: new Headers({
					"Content-Type": "application/json",
				}),
				next: { revalidate: 900 },
			},
		);
	});

	it("should fetch a persisted query without revalidate", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
			apq: true,
		});
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{ cache: "no-store", next: { revalidate: undefined } },
		);

		const queryString = new URLSearchParams(
			pruneObject({
				op: "myQuery",
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
				headers: new Headers({
					"Content-Type": "application/json",
				}),
				cache: "no-store",
				next: { revalidate: undefined },
			},
		);
	});

	it("should fetch a with custom headers", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
			apq: true,
		});
		const mockedFetch = fetchMock.mockResponse(successResponse);
		const gqlResponse = await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{ cache: "force-cache", next: { revalidate: 900 } },
			{
				headers: {
					"x-custom-header": "foo",
				},
			},
		);

		const queryString = new URLSearchParams(
			pruneObject({
				op: "myQuery",
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
				headers: new Headers({
					"Content-Type": "application/json",
					"x-custom-header": "foo",
				}),
				cache: "force-cache",
				next: { revalidate: 900 },
			},
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
			{ cache: "force-cache", next: { revalidate: 900 } },
		);

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		expect(mockedFetch).toHaveBeenCalledWith(
			"https://localhost/graphql?op=myQuery",
			{
				method: "POST", // <- Note that when caching is disabled, the method is 'POST'
				body: JSON.stringify({
					query: query.toString(),
					variables: { myVar: "baz" },
				}),
				headers: new Headers({
					"Content-Type": "application/json",
				}),
				cache: "no-store",
			},
		);
	});

	it("should not use a default timeout duration if not set", async () => {
		vi.useFakeTimers();

		const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

		const gqlServerFetch = initServerFetcher("https://localhost/graphql");

		fetchMock.mockResponse(successResponse);

		await gqlServerFetch(query, { myVar: "baz" }, {});

		vi.runAllTimers();

		expect(timeoutSpy).toHaveBeenCalledTimes(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should use the provided timeout duration", async () => {
		vi.useFakeTimers();

		const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

		const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
			defaultTimeout: 1,
			apq: true,
		});

		fetchMock.mockResponse(successResponse);

		await gqlServerFetch(query, { myVar: "baz" }, {});

		vi.runAllTimers();
		+expect(timeoutSpy).toHaveBeenCalledTimes(1);
		expect(timeoutSpy).toHaveBeenCalledWith(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const queryString = new URLSearchParams(
			pruneObject({
				op: "myQuery",
				variables: '{"myVar":"baz"}',
				extensions: `{"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}`,
			}),
		);

		expect(fetchMock).toHaveBeenCalledWith(
			`https://localhost/graphql?${queryString}`,
			{
				method: "GET", // <- Note that for persisted queries, the method is 'GET'
				headers: new Headers({
					"Content-Type": "application/json",
				}),
				cache: undefined,
				next: {},
				signal: expect.any(AbortSignal),
			},
		);
	});

	// This seems as if we test fetch itself but we're actually testing whether the fetcher properly propagates the fetch errors to the package consumers
	it("should throw when JSON can't be parsed", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		fetchMock.mockResponse("<p>Not JSON</p>");

		await expect(() =>
			gqlServerFetch(query, { myVar: "baz" }, {}),
		).rejects.toThrow();

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should throw when the server response is not ok", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		fetchMock.mockReject(new Error("Network error"));

		await expect(() =>
			gqlServerFetch(query, { myVar: "baz" }, {}),
		).rejects.toThrow();

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should use the provided signal", async () => {
		const gqlServerFetch = initServerFetcher("https://localhost/graphql");
		fetchMock.mockResponse(successResponse);

		const controller = new AbortController();
		await gqlServerFetch(
			query,
			{ myVar: "baz" },
			{},
			{ signal: controller.signal },
		);

		expect(fetchMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				signal: controller.signal,
			}),
		);

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

it("should skip persisted queries if operation apq is disabled", async () => {
	const gqlServerFetch = initServerFetcher("https://localhost/graphql", {
		apq: false,
	});
	const mockedFetch = fetchMock.mockResponseOnce(successResponse);

	const gqlResponse = await gqlServerFetch(
		query,
		{ myVar: "baz" },
		{
			next: { revalidate: 900 },
		},
	);

	expect(gqlResponse).toEqual(response);
	expect(mockedFetch).toHaveBeenCalledTimes(1);
	expect(mockedFetch).toHaveBeenNthCalledWith(
		1,
		"https://localhost/graphql?op=myQuery",
		{
			method: "POST",
			body: JSON.stringify({
				query: query.toString(),
				variables: { myVar: "baz" },
				extensions: {
					persistedQuery: {
						version: 1,
						sha256Hash: await createSha256(query.toString()),
					},
				},
			}),
			headers: new Headers({
				"Content-Type": "application/json",
			}),
			next: { revalidate: 900 },
		},
	);
});
