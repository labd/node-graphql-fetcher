import { defineConfig } from "tsdown";

export default defineConfig([
	{
		entry: ["src/index.ts"],
		clean: true,
		splitting: false,
		dts: true,
		sourcemap: true,
		format: ["esm", "cjs"],
		outDir: "dist",
		fixedExtension: false,
	},
	{
		entry: ["src/server.ts"],
		clean: true,
		splitting: false,
		dts: true,
		sourcemap: true,
		format: ["esm", "cjs"],
		outDir: "dist",
		fixedExtension: false,
	},
]);
