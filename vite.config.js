import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Mirrors api/usd-rate.js for local dev (Frankfurter USD->ILS rate).
      "/api/usd-rate": {
        target: "https://api.frankfurter.dev",
        changeOrigin: true,
        rewrite: () => "/v1/latest?from=USD&to=ILS",
      },
    },
  },
});
