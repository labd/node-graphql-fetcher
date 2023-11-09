import { ClientFetcher } from "client";
import { createContext, useContext } from "react";
import invariant from "tiny-invariant";
import * as React from "react";

/**
 * Context to provide the fetcher for the API used during client side calls
 */
export const ClientGqlFetcherContext = createContext<ClientFetcher | undefined>(
	undefined
);

export type ClientGqlFetcherProviderProps = React.PropsWithChildren<{
	fetcher: ClientFetcher;
}>;

/**
 * Provides the fetcher that should be used for client side calls to the React context
 */
export const ClientGqlFetcherProvider = ({
	children,
	fetcher,
}: ClientGqlFetcherProviderProps) => (
	<ClientGqlFetcherContext.Provider value={fetcher}>
		{children}
	</ClientGqlFetcherContext.Provider>
);

/**
 * React hook to get the fetcher that should be used for client side calls
 */
export const useClientGqlFetcher = (): ClientFetcher => {
	const context = useContext(ClientGqlFetcherContext);

	if (context === undefined) {
		if ("production" !== process.env.NODE_ENV) {
			invariant(
				false,
				"useClientGqlFetcher must be used within a ClientGqlFetcherProvider"
			);
		} else {
			invariant(false);
		}
	}

	return context as ClientFetcher;
};
