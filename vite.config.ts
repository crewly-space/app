import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The SDK, protocol and brand assets are vendored under src/. They used to be
// sibling repos linked with file:, which needed an fs.allow escape hatch here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@crewly/sdk": r("./src/sdk/index.ts"),
      "@crewly/bloop": r("./packages/bloop/src/index.ts"),
      "@crewly/protocol": r("./src/protocol/index.ts"),
      "@crewly/ui": r("./src/ui"),
    },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:4000", ws: true } },
  },
});
