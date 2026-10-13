import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { eventApiPlugin } from "./server/eventApiPlugin";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.START_PASSWORD) process.env.START_PASSWORD = env.START_PASSWORD;
  if (env.VITE_START_PASSWORD) process.env.VITE_START_PASSWORD = env.VITE_START_PASSWORD;
  if (env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = env.ADMIN_PASSWORD;
  if (env.VITE_ADMIN_PASSWORD) process.env.VITE_ADMIN_PASSWORD = env.VITE_ADMIN_PASSWORD;

  return {
    server: {
      host: "::",
      port: 8080,
      allowedHosts: ["csi.kjsitlabs.com", "localhost", "127.0.0.1"],
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      allowedHosts: ["csi.kjsitlabs.com", "localhost", "127.0.0.1"],
    },
    plugins: [react(), eventApiPlugin(), mode === "development" && componentTagger()].filter(
      Boolean
    ),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
