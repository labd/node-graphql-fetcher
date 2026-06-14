import { errorMessage } from "./helpers";

/**
 * Error thrown when a GraphQL request returns a non-2xx HTTP response.
 *
 * Carries the HTTP `status`, the raw `Response` and the parsed response `body`
 * (when readable), so consumers can branch on the status code -- e.g. retry on
 * a 401 -- without parsing an error message string.
 */
export class GraphQLFetcherError extends Error {
	readonly status: number;
	readonly statusText: string;
	readonly response: Response;
	readonly body: unknown;

	constructor(response: Response, body: unknown, operationName?: string) {
		super(
			errorMessage(
				`Response${operationName ? ` for ${operationName}` : ""} not ok: ${response.status} ${response.statusText}`,
			),
		);
		this.name = "GraphQLFetcherError";
		this.status = response.status;
		this.statusText = response.statusText;
		this.response = response;
		this.body = body;
	}

	// Reads the body off a clone so the original response stays consumable, then
	// attaches it to the error -- the previous implementation discarded the body
	// of failed responses entirely.
	static async fromResponse(
		response: Response,
		operationName?: string,
	): Promise<GraphQLFetcherError> {
		return new GraphQLFetcherError(
			response,
			await readBody(response),
			operationName,
		);
	}
}

const readBody = async (response: Response): Promise<unknown> => {
	try {
		const text = await response.clone().text();
		if (!text) {
			return undefined;
		}
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	} catch {
		return undefined;
	}
};
