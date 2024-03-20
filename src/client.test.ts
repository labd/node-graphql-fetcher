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
				body: '{"query":"\\n\\tquery myQuery {\\n\\t\\tfoo\\n\\t\\tbar\\n\\t}\\n","variables":{"myVar":"baz"},"extensions":{}}',
				// Method was post:
				method: "POST",
				// These exact headers should be set:
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
			}
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
			"https://localhost/graphql?op=myQuery&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22e5276e0694f661ef818210402d06d249625ef169a1c2b60383acb2c42d45f7ae%22%7D%7D&variables=%7B%22myVar%22%3A%22baz%22%7D",
			{
				// Query is persisted, uses GET to be cached by CDN
				method: "GET",
				// These exact headers should be set:
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
			}
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
			expect.anything() // <- body, method, headers, etc, are tested in the above
		);
	});

	it("should throw when fetch fails", () => {
		fetchMock.mockReject(new Error("Network error"));

		expect(fetcher(query, { myVar: "baz" })).rejects.toThrow("Network error");
	});
	it("should fallback to POST when persisted query is not found on the server", async () => {
		const mockedFetch = fetchMock.mockResponses(
			JSON.stringify({
				errors: [{ message: "PersistedQueryNotFound" }],
			}),
			responseString
		);

		const gqlResponse = await persistedFetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);
		// Should do two calls, a GET and a POST request
		expect(mockedFetch).toHaveBeenCalledTimes(2);
	});
	it("should throw when JSON can't be parsed", () => {
		fetchMock.mockResponse("<p>Not JSON</p>");

		const gqlResponse = fetcher(query, { myVar: "baz" });

		expect(gqlResponse).rejects.toThrow();
	});
});
