import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/providers/local.ts",
    "src/providers/e2b.ts",
    "src/providers/daytona.ts",
    "src/providers/docker.ts",
    "src/providers/vercel.ts",
    "src/providers/cloudflare.ts",
    "src/providers/modal.ts",
    "src/providers/computesdk.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["@cloudflare/sandbox", "@daytonaio/sdk", "@e2b/code-interpreter", "@vercel/sandbox", "dockerode", "get-port", "modal", "computesdk"],
});
