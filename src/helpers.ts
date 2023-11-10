import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

export const extractOperationName = (query: string) => {
	const matches = query.match(/(query|mutation)\s(\w+)/);
	return matches?.[2];
};

export const defaultHeaders: Record<string, string> = {
	"Content-Type": "application/json",
};

export type GraphQLError = {
	message: string;
	extensions: {
		code: string;
		serviceName: string;
		message?: string;
		exception?: { message: string };
	};
};

export type GqlResponse<TResponse> = {
	data: TResponse | null;
	errors: GraphQLError[] | null;
};

export interface NextFetchRequestConfig {
	revalidate?: number | false;
	tags?: string[];
}

export const pruneObject = <T>(object: T): Partial<T> =>
	JSON.parse(JSON.stringify(object ?? null));

export class TypedDocumentString<TResult, TVariables>
	extends String
	implements DocumentTypeDecoration<TResult, TVariables>
{
	__apiType?: DocumentTypeDecoration<TResult, TVariables>["__apiType"];

	constructor(private value: string, public __meta__?: Record<string, any>) {
		super(value);
	}

	toString(): string & DocumentTypeDecoration<TResult, TVariables> {
		return this.value;
	}
}

export const createErrorPrefix = (...args: any[]) =>
	["Error in query:", ...args].join("\n");

export const createSha256 = async (message: string) => {
	const encoder = new TextEncoder();
	const data = encoder.encode(message);

	return await crypto.subtle.digest("SHA-256", data);
};
