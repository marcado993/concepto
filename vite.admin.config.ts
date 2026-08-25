import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Build APARTE del de la app pública (vite.config.ts / npm run build) —
// entrada admin.html, salida dist-admin/. Nunca lo corre Vercel (que solo
// conoce el comando "build" por defecto = vite.config.ts / index.html);
// este se corre a mano/por deploy script y el resultado se copia al VPS,
// donde lo sirve Caddy SOLO en la red Tailscale (ver Caddyfile,
// panel.aeis-app.online). Mantener esto separado del build público es el
// punto entero del pedido: el panel de administración no debe ni existir
// como archivo estático alcanzable desde el internet público.
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "dist-admin",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "admin.html"),
    },
  },
});
