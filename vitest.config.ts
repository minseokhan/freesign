import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**", "**/e2e/**", ".claude/**"],
    globals: true,
    globalSetup: ["./src/test/pg-global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        // @polar-sh/nextjs를 외부 모듈로 두면 node가 next/server 서브패스를 못 찾는다.
        // 웹훅 어댑터를 mock 없이 실물로 태우려면 vite가 변환하도록 인라인해야 한다.
        inline: [/@polar-sh\/nextjs/]
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  }
});
