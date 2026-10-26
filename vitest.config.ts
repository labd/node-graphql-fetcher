import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			reportsDirectory: "./test-reports/",
		},
		setupFiles: [path.join(__dirname, "vitest.setup.ts")],
		passWithNoTests: true,
	},
});
