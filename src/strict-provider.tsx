import type { StrictClientFetcher } from "client";
import { createContext, useContext } from "react";
import invariant from "tiny-invariant";
import type { PropsWithChildren } from "react";

/**
 * Context to provide the fetcher for the API used during client side calls
 */
export const StrictClientGqlFetcherContext = createContext<
	StrictClientFetcher | undefined
>(undefined);

export type StrictClientGqlFetcherProviderProps = PropsWithChildren<{
	fetcher: StrictClientFetcher;
}>;

/**
 * Provides the fetcher that should be used for client side calls to the React context
 */
export const StrictClientGqlFetcherProvider = ({
	children,
	fetcher,
}: StrictClientGqlFetcherProviderProps) => (
	<StrictClientGqlFetcherContext.Provider value={fetcher}>
		{children}
	</StrictClientGqlFetcherContext.Provider>
);

/**
 * React hook to get the fetcher that should be used for client side calls
 */
export const useStrictClientGqlFetcher = (): StrictClientFetcher => {
	const context = useContext(StrictClientGqlFetcherContext);

	if (context === undefined) {
		if ("production" !== process.env.NODE_ENV) {
			invariant(
				false,
				"useStrictClientGqlFetcher must be used within a ClientGqlFetcherProvider",
			);
		} else {
			invariant(false);
		}
	}

	return context as StrictClientFetcher;
};
