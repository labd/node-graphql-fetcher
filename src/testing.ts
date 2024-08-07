import { DocumentTypeDecoration } from "@graphql-typed-document-node/core";

export class TypedDocumentString<TResult, TVariables>
	extends String
	implements DocumentTypeDecoration<TResult, TVariables>
{
	__apiType?: DocumentTypeDecoration<TResult, TVariables>["__apiType"];

	constructor(private value: string, public __meta__?: Record<string, any>) {
		super(value);
	}
}
