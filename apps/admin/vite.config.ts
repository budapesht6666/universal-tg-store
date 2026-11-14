import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Локально API и фото отдаёт сервер (pnpm dev поднимает всё).
const server = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: { "/api": server, "/uploads": server },
  },
});
