import tsconfigPaths from "vite-tsconfig-paths";
import {defineConfig} from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    hideSkippedTests: true,
    passWithNoTests: true,
    testTimeout: 500_000,
    hookTimeout: 100_000,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./src/modules/common/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ]
  },
});
