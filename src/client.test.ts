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
import { TypedDocumentString } from "./helpers";

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
				body: '{"query":"\\n\\tquery myQuery {\\n\\t\\tfoo\\n\\t\\tbar\\n\\t}\\n","variables":{"myVar":"baz"}}',
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
});
