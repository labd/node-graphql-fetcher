import { createRequestSearchParams, type GraphQLRequest } from "request";
import { expect, it } from "vitest";

it.each(["both", "document", "persistent"])(
	"createRequestURL - mode=%s",
	(mode) => {
		const data = createRequestSearchParams({
			mode: mode,
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

		const result: Record<string, unknown> = {}
		data.forEach((value, key) => {
			result[key] = value
		})

		switch (mode) {
			case "both": {
				expect(result).toStrictEqual(
					{
						documentId: "123",
						op: "hello",
						variables: '{"name":"world"}',
						extensions: '{"persistedQuery":{"version":1,"sha256Hash":"123"}}',
					},
				);
				break;
			}
			case "persisted": {
				expect(result).toStrictEqual(
					{
						documentId: "123",
						op: "hello",
						variables: '{"name":"world"}',
						extensions: '{"persistedQuery":{"version":1,"sha256Hash":"123"}}',
					}
				);
				break;
			}
			case "document": {
				expect(result).toStrictEqual(
					{
						op: "hello",
						variables: '{"name":"world"}',
						extensions: '{"persistedQuery":{"version":1,"sha256Hash":"123"}}',
					}
				);
				break;
			}
		}
	},
);


it.each(["both", "document", "persistent"])(
	"createRequestURL - minimal mode=%s",
	(mode) => {
		const data = createRequestSearchParams({
			mode: mode,
			query: "query { hello }",
			variables: {},
			operationName: "hello",
			documentId: "123",
		} as GraphQLRequest<Record<string, unknown>>);

		const result: Record<string, unknown> = {}
		data.forEach((value, key) => {
			result[key] = value
		})

		switch (mode) {
			case "both": {
				expect(result).toStrictEqual(
					{
						documentId: "123",
						op: "hello",
					},
				);
				break;
			}
			case "persisted": {
				expect(result).toStrictEqual(
					{
						documentId: "123",
						op: "hello",
					}
				);
				break;
			}
			case "document": {
				expect(result).toStrictEqual(
					{
						op: "hello",
					}
				);
				break;
			}
		}
	},
);

