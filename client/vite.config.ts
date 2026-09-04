import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const shared = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": shared },
  },
  server: {
    // `npm run dev` in one shell, `npm run client:dev` in another.
    proxy: {
      "/socket.io": { target: "http://localhost:5000", ws: true },
    },
  },
});
