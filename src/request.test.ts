import { createRequestSearchParams, type GraphQLRequest } from "request";
import { expect, it } from "vitest";

it.each([true, false])(
	"createRequestSearchParams - includeQuery=%s",
	(includeQuery) => {
		const data = createRequestSearchParams({
			includeQuery: includeQuery,
			query: "query { hello }",
			variables: { name: "world" },
			operationName: "hello",
			extensions: {
				persistedQuery: {
					version: 1,
					sha256Hash: "123",
				},
			},
			documentId: "123",
		} as GraphQLRequest<Record<string, unknown>>);

		const result: Record<string, unknown> = {};
		data.forEach((value, key) => {
			result[key] = value;
		});

		if (includeQuery) {
			expect(result).toStrictEqual({
				documentId: "123",
				op: "hello",
				variables: '{"name":"world"}',
				extensions: '{"persistedQuery":{"version":1,"sha256Hash":"123"}}',
			});
		} else {
			expect(result).toStrictEqual({
				documentId: "123",
				op: "hello",
				variables: '{"name":"world"}',
			});
		}
	},
);

it.each([true, false])(
	"createRequestSearchParams - minimal includeQuery=%s",
	(includeQuery) => {
		const data = createRequestSearchParams({
			includeQuery,
			query: "query { hello }",
			variables: {},
			operationName: "hello",
			documentId: "123",
		} as GraphQLRequest<Record<string, unknown>>);

		const result: Record<string, unknown> = {};
		data.forEach((value, key) => {
			result[key] = value;
		});

		if (includeQuery) {
			expect(result).toStrictEqual({
				documentId: "123",
				op: "hello",
			});
		} else {
			expect(result).toStrictEqual({
				documentId: "123",
				op: "hello",
			});
		}
	},
);
