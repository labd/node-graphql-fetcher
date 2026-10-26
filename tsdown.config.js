import { defineConfig } from "tsdown";

export default defineConfig([
	{
		entry: ["src/index.ts"],
		publint: true,
		failOnWarn: true,
		// TypeScript 7 is used on purpose; its "experimental API" notice is not actionable
		suppressWarnings: ["TypeScript 7.0 does not yet have a stable API"],
		clean: true,
		splitting: false,
		dts: true,
		sourcemap: true,
		format: ["esm"],
		outDir: "dist",
		fixedExtension: false,
	},
	{
		entry: ["src/server.ts"],
		publint: true,
		failOnWarn: true,
		// TypeScript 7 is used on purpose; its "experimental API" notice is not actionable
		suppressWarnings: ["TypeScript 7.0 does not yet have a stable API"],
		clean: true,
		splitting: false,
		dts: true,
		sourcemap: true,
		format: ["esm"],
		outDir: "dist",
		fixedExtension: false,
	},
	{
		entry: ["src/react.ts"],
		publint: true,
		failOnWarn: true,
		// TypeScript 7 is used on purpose; its "experimental API" notice is not actionable
		// "use client" is kept in the output; rolldown warns about it regardless
		suppressWarnings: [
			"TypeScript 7.0 does not yet have a stable API",
			'module level directive "use client"',
		],
		clean: true,
		splitting: false,
		dts: true,
		sourcemap: true,
		format: ["esm"],
		outDir: "dist",
		fixedExtension: false,
	},
]);
