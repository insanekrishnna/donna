import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // One .env for the whole project, at the repo root. Vite exposes only VITE_* values to the browser.
  envDir: "..",
  resolve: {
    // The Arkiv schema module is shared with the server (../server/src/schemas/arkiv.ts).
    // Resolve its imports to this app's copies, so there is one viem, zod and Arkiv SDK.
    dedupe: ["viem", "zod", "@arkiv-network/sdk"],
  },
  server: { port: 5173, strictPort: true, fs: { allow: [".."] } },
});
