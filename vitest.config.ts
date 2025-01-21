import path from "node:path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		coverage: {
			provider: "v8",
			all: true,
			include: ["src/**/*.ts"],
			reportsDirectory: "./test-reports/",
		},
		setupFiles: [path.join(__dirname, "vitest.setup.ts")],
		passWithNoTests: true,
	},
});
