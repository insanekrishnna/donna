import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // One .env for the whole project, at the repo root. Vite exposes only VITE_* values to the browser.
  envDir: "..",
  resolve: {
    // One copy each of viem, zod and the Arkiv SDK (wagmi and the SDK both depend on viem).
    dedupe: ["viem", "zod", "@arkiv-network/sdk"],
  },
  server: { port: 5173, strictPort: true },
});
