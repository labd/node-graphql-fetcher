import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import createFetchMock from "vitest-fetch-mock";
import { initClientFetcher } from "./client";
import { TypedDocumentString } from "./testing";
import { createSha256 } from "helpers";

const query = new TypedDocumentString(/* GraphQL */ `
	query myQuery {
		foo
		bar
	}
`);

const mutation = new TypedDocumentString(/* GraphQL */ `
	mutation myMutation {
		foo
		bar
	}
`);

const response = { foo: "foo", bar: "bar" };
const responseString = JSON.stringify(response);
const fetchMock = createFetchMock(vi);

describe("gqlClientFetch", () => {
	beforeAll(() => fetchMock.enableMocks());
	afterAll(() => fetchMock.disableMocks());
	beforeEach(() => fetchMock.resetMocks());

	const fetcher = initClientFetcher("https://localhost/graphql");
	const persistedFetcher = initClientFetcher("https://localhost/graphql", {
		persistedQueries: true,
	});

	it("should perform a query", async () => {
		const mockedFetch = fetchMock.mockResponse(responseString);
		const gqlResponse = await fetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);

		expect(mockedFetch).toHaveBeenCalledWith(
			// This exact URL should be called, note the ?op=myQuery.
			"https://localhost/graphql?op=myQuery",
			{
				// This exact body should be sent:
				body: JSON.stringify({
					query: query,
					variables: { myVar: "baz" },
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: await createSha256(query.toString()),
						},
					},
				}),
				// Method was post:
				method: "POST",
				// These exact headers should be set:
				credentials: "include",
				headers: new Headers({
					"content-type": "application/json",
				}),
				signal: expect.any(AbortSignal),
			},
		);
	});

	it("should perform a persisted query when enabled", async () => {
		const mockedFetch = fetchMock.mockResponse(responseString);

		const gqlResponse = await persistedFetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);
		expect(mockedFetch).toHaveBeenCalledWith(
			// When persisted queries are enabled, we suffix all the variables and extensions as search parameters
			"https://localhost/graphql?op=myQuery&variables=%7B%22myVar%22%3A%22baz%22%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22e5276e0694f661ef818210402d06d249625ef169a1c2b60383acb2c42d45f7ae%22%7D%7D",
			{
				// Query is persisted, uses GET to be cached by CDN
				method: "GET",
				// These exact headers should be set:
				credentials: "include",
				headers: new Headers({
					"content-type": "application/json",
				}),
				signal: expect.any(AbortSignal),
			},
		);
	});
	it("should perform a mutation", async () => {
		const mockedFetch = fetchMock.mockResponse(responseString);
		const gqlResponse = await fetcher(mutation, {
			myVar: "baz",
		});
		expect(gqlResponse).toEqual(response);

		expect(mockedFetch).toHaveBeenCalledWith(
			// This exact URL should be called, note the ?op=myMutation
			"https://localhost/graphql?op=myMutation",
			expect.anything(), // <- body, method, headers, etc, are tested in the above
		);
	});

	it("should throw when fetch fails", async () => {
		fetchMock.mockReject(new Error("Network error"));

		await expect(fetcher(query, { myVar: "baz" })).rejects.toThrow(
			"Network error",
		);
	});

	it("should fallback to POST when persisted query is not found on the server", async () => {
		const mockedFetch = fetchMock.mockResponses(
			JSON.stringify({
				errors: [{ message: "PersistedQueryNotFound" }],
			}),
			responseString,
		);

		const gqlResponse = await persistedFetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);
		// Should do two calls, a GET and a POST request
		expect(mockedFetch).toHaveBeenCalledTimes(2);
	});

	// This seems as if we test fetch itself but we're actually testing whether the fetcher properly propagates the fetch errors to the package consumers
	it("should throw when JSON can't be parsed", async () => {
		fetchMock.mockResponse("<p>Not JSON</p>");

		const gqlResponse = fetcher(query, { myVar: "baz" });

		await expect(gqlResponse).rejects.toThrow();
	});

	it("should not fallback to POST if the persisted query cannot be parsed", async () => {
		fetchMock.mockResponse("<p>Not JSON</p>");

		const gqlResponse = persistedFetcher(query, { myVar: "baz" });

		await expect(gqlResponse).rejects.toThrow();
	});

	it("should not fallback to POST if the persisted query returns an error from the server", async () => {
		fetchMock.mockReject(new Error("Network error"));

		const gqlResponse = persistedFetcher(query, { myVar: "baz" });

		await expect(gqlResponse).rejects.toThrow();
	});

	it("should use time out after 30 seconds by default", async () => {
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
		fetchMock.mockResponse(responseString);

		await fetcher(query, {
			myVar: "baz",
		});

		expect(timeoutSpy).toHaveBeenCalledWith(30000);

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should use the provided timeout duration", async () => {
		vi.useFakeTimers();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			defaultTimeout: 1,
		});
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
		fetchMock.mockResponse(responseString);

		await fetcher(query, {
			myVar: "baz",
		});

		vi.runAllTimers();

		expect(timeoutSpy).toHaveBeenCalledWith(1);

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("should use the provided signal", async () => {
		const fetcher = initClientFetcher("https://localhost/graphql");
		fetchMock.mockResponse(responseString);

		const controller = new AbortController();
		await fetcher(
			query,
			{
				myVar: "baz",
			},
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

	it("should allow passing extra HTTP headers", async () => {
		const mockedFetch = fetchMock.mockResponse(responseString);
		const gqlResponse = await fetcher(
			query,
			{
				myVar: "baz",
			},
			{
				headers: {
					"X-extra-header": "foo",
				},
			},
		);

		expect(gqlResponse).toEqual(response);

		expect(mockedFetch).toHaveBeenCalledWith(
			// This exact URL should be called, note the ?op=myQuery.
			"https://localhost/graphql?op=myQuery",
			{
				// This exact body should be sent:
				body: JSON.stringify({
					query: query,
					variables: { myVar: "baz" },
					extensions: {
						persistedQuery: {
							version: 1,
							sha256Hash: await createSha256(query.toString()),
						},
					},
				}),
				// Method was post:
				method: "POST",
				// These exact headers should be set:
				credentials: "include",
				headers: new Headers({
					"Content-Type": "application/json",
					"X-extra-header": "foo",
				}),
				signal: expect.any(AbortSignal),
			},
		);
	});
});
