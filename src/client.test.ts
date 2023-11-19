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

	// Run test without any queueing options, so request-2 is handled before
	// request-1
	it("should not queue multiple mutations", async () => {
		const callOrder: string[] = [];
		const delay = (ms: number) =>
			new Promise((resolve) => setTimeout(resolve, ms));

		fetchMock.mockResponse(async (req) => {
			const data = await req.json();
			if (data.variables.myVar === "request-1") {
				return delay(50).then(() => {
					// Simulate delay
					callOrder.push("request-1");
					return Promise.resolve(responseString); // Response for myMutation1
				});
			} else if (data.variables.myVar === "request-2") {
				return Promise.resolve().then(() => {
					callOrder.push("request-2");
					return responseString; // Response for myMutation2
				});
			}
			return "404";
		});

		const fetcherPromise1 = fetcher(mutation, { myVar: "request-1" });
		const fetcherPromise2 = fetcher(mutation, { myVar: "request-2" });

		const [gqlResponse1, gqlResponse2] = await Promise.all([
			fetcherPromise1,
			fetcherPromise2,
		]);

		// Check if the responses are as expected
		expect(gqlResponse1).toEqual(response);
		expect(gqlResponse2).toEqual(response);

		// Check the order of calls
		expect(callOrder).toEqual(["request-2", "request-1"]);
	});

	it("should queue multiple mutations", async () => {
		const callOrder: string[] = [];
		const delay = (ms: number) =>
			new Promise((resolve) => setTimeout(resolve, ms));

		fetchMock.mockResponse(async (req) => {
			const data = await req.json();
			if (data.variables.myVar === "request-1") {
				return delay(50).then(() => {
					// Simulate delay
					callOrder.push("request-1");
					return Promise.resolve(responseString); // Response for myMutation1
				});
			} else if (data.variables.myVar === "request-2") {
				return Promise.resolve().then(() => {
					callOrder.push("request-2");
					return responseString; // Response for myMutation2
				});
			}
			return "404";
		});

		const fetcherPromise1 = fetcher(
			mutation,
			{ myVar: "request-1" },
			{ queueName: "myQueue" }
		);
		const fetcherPromise2 = fetcher(
			mutation,
			{ myVar: "request-2" },
			{ queueName: "myQueue" }
		);

		const [gqlResponse1, gqlResponse2] = await Promise.all([
			fetcherPromise1,
			fetcherPromise2,
		]);

		// Check if the responses are as expected
		expect(gqlResponse1).toEqual(response);
		expect(gqlResponse2).toEqual(response);

		// Check the order of calls
		expect(callOrder).toEqual(["request-1", "request-2"]);
	});
});
