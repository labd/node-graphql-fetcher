import { beforeEach, vi } from "vitest";
import createFetchMock from "vitest-fetch-mock";

const fetchMocker = createFetchMock(vi);

// adds the 'fetchMock' global variable and rewires 'fetch' global to call
// 'fetchMock' instead of the real implementation
fetchMocker.enableMocks();

process.env.CLIENT_API_GATEWAY_URL = "https://localhost";

if (typeof window === "undefined" && !globalThis.crypto) {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	globalThis.crypto = require("node:crypto").webcrypto;
}

beforeEach(() => {
	fetchMocker.resetMocks();
});
