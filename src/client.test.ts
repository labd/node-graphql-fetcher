import { createSha256 } from "helpers";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { initClientFetcher, initStrictClientFetcher } from "./client";
import { GraphQLFetcherError } from "./errors";
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

const data = { foo: "foo", bar: "bar" };
const response = { data: data, errors: undefined };
const successResponse = JSON.stringify(response);

const errorResponse = JSON.stringify({
	data: undefined,
	errors: [{ message: "PersistedQueryNotFound" }],
});

const nestedErrorResponse = JSON.stringify({
	errors: [
		{
			message: "Starship not found",
			locations: [
				{
					line: 3,
					column: 3,
				},
			],
			path: ["secondShip"],
		},
	],
	data: {
		firstShip: "3001",
		secondShip: null,
	},
});

const server = setupServer();
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
	server.resetHandlers();
	fetchSpy?.mockRestore();
});
afterAll(() => server.close());

function spyOnFetch() {
	fetchSpy = vi.spyOn(globalThis, "fetch");
	return fetchSpy;
}

describe("gqlClientFetch", () => {
	const fetcher = initClientFetcher("https://localhost/graphql");
	const persistedFetcher = initClientFetcher("https://localhost/graphql", {
		persistedQueries: true,
	});

	it("should perform a query", async () => {
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const gqlResponse = await fetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);

		expect(spy).toHaveBeenCalledWith(
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
		const spy = spyOnFetch();
		server.use(
			http.get("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const gqlResponse = await persistedFetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);
		expect(spy).toHaveBeenCalledWith(
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
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const gqlResponse = await fetcher(mutation, {
			myVar: "baz",
		});
		expect(gqlResponse).toEqual(response);

		expect(spy).toHaveBeenCalledWith(
			// This exact URL should be called, note the ?op=myMutation
			"https://localhost/graphql?op=myMutation",
			expect.anything(), // <- body, method, headers, etc, are tested in the above
		);
	});

	it("should throw when fetch fails", async () => {
		server.use(
			http.post("https://localhost/graphql", () => HttpResponse.error()),
		);

		await expect(fetcher(query, { myVar: "baz" })).rejects.toThrow();
	});

	it("should fallback to POST when persisted query is not found on the server", async () => {
		const spy = spyOnFetch();
		let callCount = 0;
		server.use(
			http.get("https://localhost/graphql", () => {
				callCount++;
				return HttpResponse.text(errorResponse);
			}),
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const gqlResponse = await persistedFetcher(query, {
			myVar: "baz",
		});

		expect(gqlResponse).toEqual(response);
		// Should do two calls, a GET and a POST request
		expect(spy).toHaveBeenCalledTimes(2);
	});

	// This seems as if we test fetch itself but we're actually testing whether the fetcher properly propagates the fetch errors to the package consumers
	it("should throw when JSON can't be parsed", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text("<p>Not JSON</p>"),
			),
		);

		const gqlResponse = fetcher(query, { myVar: "baz" });

		await expect(gqlResponse).rejects.toThrow();
	});

	it("should not fallback to POST if the persisted query cannot be parsed", async () => {
		server.use(
			http.get("https://localhost/graphql", () =>
				HttpResponse.text("<p>Not JSON</p>"),
			),
		);

		const gqlResponse = persistedFetcher(query, { myVar: "baz" });

		await expect(gqlResponse).rejects.toThrow();
	});

	it("should not fallback to POST if the persisted query returns an error from the server", async () => {
		server.use(
			http.get("https://localhost/graphql", () => HttpResponse.error()),
		);

		const gqlResponse = persistedFetcher(query, { myVar: "baz" });

		await expect(gqlResponse).rejects.toThrow();
	});

	it("should use time out after 30 seconds by default", async () => {
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		await fetcher(query, {
			myVar: "baz",
		});

		expect(timeoutSpy).toHaveBeenCalledWith(30000);

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("should use the provided timeout duration", async () => {
		vi.useFakeTimers();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			defaultTimeout: 1,
		});
		const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		await fetcher(query, {
			myVar: "baz",
		});

		vi.runAllTimers();

		expect(timeoutSpy).toHaveBeenCalledWith(1);

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("should use the provided signal", async () => {
		const fetcher = initClientFetcher("https://localhost/graphql");
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const controller = new AbortController();
		await fetcher(
			query,
			{
				myVar: "baz",
			},
			{ signal: controller.signal },
		);

		expect(spy).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				signal: controller.signal,
			}),
		);

		// It should not try to POST the query if the persisted query cannot be parsed
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("should allow passing extra HTTP headers", async () => {
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

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

		expect(spy).toHaveBeenCalledWith(
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

describe("GraphQLFetcherError", () => {
	it("carries the status, statusText and parsed body of a non-2xx response", async () => {
		const body = { errors: [{ message: "nope" }] };
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json(body, { status: 401, statusText: "Unauthorized" }),
			),
		);

		const fetcher = initClientFetcher("https://localhost/graphql");
		const error = await fetcher(query, { myVar: "baz" }).catch((e) => e);

		expect(error).toBeInstanceOf(GraphQLFetcherError);
		expect(error.status).toBe(401);
		expect(error.statusText).toBe("Unauthorized");
		expect(error.body).toEqual(body);
	});
});

describe("retry", () => {
	it("retries an HTTP 401 once after onRetry, then succeeds", async () => {
		const spy = spyOnFetch();
		let call = 0;
		server.use(
			http.post("https://localhost/graphql", () => {
				call++;
				return call === 1
					? HttpResponse.json({}, { status: 401 })
					: HttpResponse.text(successResponse);
			}),
		);

		const onRetry = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			retry: {
				shouldRetry: (ctx) =>
					ctx.error instanceof GraphQLFetcherError && ctx.error.status === 401,
				onRetry,
			},
		});

		const result = await fetcher(query, { myVar: "baz" });

		expect(result).toEqual(response);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("retries on a GraphQL error code returned with a 2xx", async () => {
		let call = 0;
		server.use(
			http.post("https://localhost/graphql", () => {
				call++;
				return call === 1
					? HttpResponse.json({
							data: null,
							errors: [{ extensions: { code: "REQUIRES_SESSION" } }],
						})
					: HttpResponse.text(successResponse);
			}),
		);

		const fetcher = initClientFetcher("https://localhost/graphql", {
			retry: {
				shouldRetry: (ctx) =>
					ctx.result?.errors?.some(
						(e) => e.extensions?.code === "REQUIRES_SESSION",
					) ?? false,
			},
		});

		const result = await fetcher(query, { myVar: "baz" });
		expect(result).toEqual(response);
	});

	it("does not retry when shouldRetry returns false", async () => {
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({}, { status: 401 }),
			),
		);

		const fetcher = initClientFetcher("https://localhost/graphql", {
			retry: { shouldRetry: () => false },
		});

		await expect(fetcher(query, { myVar: "baz" })).rejects.toBeInstanceOf(
			GraphQLFetcherError,
		);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("retries at most `max` times then throws", async () => {
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({}, { status: 401 }),
			),
		);

		const fetcher = initClientFetcher("https://localhost/graphql", {
			retry: { max: 2, shouldRetry: () => true },
		});

		await expect(fetcher(query, { myVar: "baz" })).rejects.toBeInstanceOf(
			GraphQLFetcherError,
		);
		// initial attempt + 2 retries
		expect(spy).toHaveBeenCalledTimes(3);
	});
});

describe("logger", () => {
	it("logs an error when a request fails with a non-2xx", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({ errors: [{ message: "nope" }] }, { status: 500 }),
			),
		);

		const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
		const fetcher = initClientFetcher("https://localhost/graphql", { logger });

		await expect(fetcher(query, { myVar: "baz" })).rejects.toBeInstanceOf(
			GraphQLFetcherError,
		);
		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining("500"),
			expect.objectContaining({ status: 500, operationName: "myQuery" }),
		);
	});

	it("does not use the logger for GraphQL errors on a 2xx (that is onGraphQLErrors' job)", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({
					data: null,
					errors: [{ message: "boom" }],
				}),
			),
		);

		const logger = { warn: vi.fn(), error: vi.fn() };
		const fetcher = initClientFetcher("https://localhost/graphql", { logger });

		await fetcher(query, { myVar: "baz" });
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("does not warn for the PersistedQueryNotFound fallback signal", async () => {
		server.use(
			http.get("https://localhost/graphql", () =>
				HttpResponse.text(errorResponse),
			),
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const logger = { debug: vi.fn(), warn: vi.fn() };
		const fetcher = initClientFetcher("https://localhost/graphql", {
			persistedQueries: true,
			logger,
		});

		await fetcher(query, { myVar: "baz" });
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith(
			"Persisted query not found, falling back to POST",
			expect.objectContaining({ operationName: "myQuery" }),
		);
	});
});

describe("onGraphQLErrors", () => {
	const errorResponseBody = JSON.stringify({
		data: { catalogPage: { name: "Tennis" } },
		errors: [
			{
				message: "Category not found",
				path: ["catalogPage", "productListingConfig"],
				extensions: { code: "NOT_FOUND" },
			},
		],
	});

	it("calls the hook with errors and request context on a 2xx-with-errors", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(errorResponseBody, {
					headers: { "x-request-id": "req-123" },
				}),
			),
		);

		const onGraphQLErrors = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			onGraphQLErrors,
		});

		await fetcher(query, { myVar: "baz" });

		expect(onGraphQLErrors).toHaveBeenCalledTimes(1);
		const [errors, context] = onGraphQLErrors.mock.calls[0];
		expect(errors[0].message).toBe("Category not found");
		expect(context).toMatchObject({
			operationName: "myQuery",
			variables: { myVar: "baz" },
		});
		// The full response is available so the callback can inspect partial data.
		expect(context.response.data).toEqual({ catalogPage: { name: "Tennis" } });
		expect(context.response.errors).toHaveLength(1);
		// The raw HTTP response exposes status and headers.
		expect(context.httpResponse.status).toBe(200);
		expect(context.httpResponse.headers.get("x-request-id")).toBe("req-123");
	});

	it("is not called for a clean response", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const onGraphQLErrors = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			onGraphQLErrors,
		});

		await fetcher(query, { myVar: "baz" });
		expect(onGraphQLErrors).not.toHaveBeenCalled();
	});

	it("does not fire for the PersistedQueryNotFound fallback signal", async () => {
		server.use(
			http.get("https://localhost/graphql", () =>
				HttpResponse.text(errorResponse),
			),
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const onGraphQLErrors = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			persistedQueries: true,
			onGraphQLErrors,
		});

		await fetcher(query, { myVar: "baz" });
		expect(onGraphQLErrors).not.toHaveBeenCalled();
	});

	it("rejects the fetch call when the hook throws (escalate path)", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(errorResponseBody),
			),
		);

		const fetcher = initClientFetcher("https://localhost/graphql", {
			onGraphQLErrors: (errors) => {
				throw new Error(errors[0].message);
			},
		});

		await expect(fetcher(query, { myVar: "baz" })).rejects.toThrow(
			"Category not found",
		);
	});
});

describe("onRequestError", () => {
	it("is called with the thrown error on a non-2xx", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({}, { status: 500 }),
			),
		);

		const onRequestError = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			onRequestError,
		});

		await expect(fetcher(query, { myVar: "baz" })).rejects.toBeInstanceOf(
			GraphQLFetcherError,
		);
		expect(onRequestError).toHaveBeenCalledTimes(1);
		const [error, context] = onRequestError.mock.calls[0];
		expect(error).toBeInstanceOf(GraphQLFetcherError);
		expect(error.status).toBe(500);
		expect(context).toMatchObject({ operationName: "myQuery" });
	});

	it("is not called for a successful response", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const onRequestError = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			onRequestError,
		});

		await fetcher(query, { myVar: "baz" });
		expect(onRequestError).not.toHaveBeenCalled();
	});

	it("fires once, after retries are exhausted", async () => {
		const spy = spyOnFetch();
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({}, { status: 401 }),
			),
		);

		const onRequestError = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			retry: { max: 2, shouldRetry: () => true },
			onRequestError,
		});

		await expect(fetcher(query, { myVar: "baz" })).rejects.toBeInstanceOf(
			GraphQLFetcherError,
		);
		expect(spy).toHaveBeenCalledTimes(3); // initial + 2 retries
		expect(onRequestError).toHaveBeenCalledTimes(1); // terminal only
	});

	it("is not triggered when onGraphQLErrors throws (escalation, not a request error)", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.json({ data: null, errors: [{ message: "boom" }] }),
			),
		);

		const onRequestError = vi.fn();
		const fetcher = initClientFetcher("https://localhost/graphql", {
			onGraphQLErrors: () => {
				throw new Error("escalated");
			},
			onRequestError,
		});

		await expect(fetcher(query, { myVar: "baz" })).rejects.toThrow("escalated");
		expect(onRequestError).not.toHaveBeenCalled();
	});
});

describe("initStrictClientFetcher", () => {
	it("should return the data directory if no error occurred", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(successResponse),
			),
		);

		const gqlClientFetch = initStrictClientFetcher("https://localhost/graphql");
		const gqlResponse = await gqlClientFetch(query as any, { myVar: "baz" });

		expect(gqlResponse).toEqual(data);
	});
	it("should throw an aggregate error if a generic one occurred", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(errorResponse),
			),
		);

		const gqlClientFetch = initStrictClientFetcher("https://localhost/graphql");
		const promise = gqlClientFetch(query as any, { myVar: "baz" });

		await expect(promise).rejects.toThrow();
	});
	it("should return a response with a nested error thrown", async () => {
		server.use(
			http.post("https://localhost/graphql", () =>
				HttpResponse.text(nestedErrorResponse),
			),
		);

		const gqlClientFetch = initStrictClientFetcher("https://localhost/graphql");
		const result = await gqlClientFetch(query as any, { myVar: "baz" });

		expect(result).toBeTruthy();
		expect(result.firstShip).toBe("3001");
		expect(() => result.secondShip).toThrowError("Starship not found");
	});
});
