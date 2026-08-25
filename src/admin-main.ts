import { mount } from "svelte";
import "./app.css";
import AdminApp from "./lib/admin/AdminApp.svelte";

// Punto de entrada del panel de administración — build/deploy propios (ver
// vite.admin.config.ts, admin.html), servidos SOLO por Caddy en la red
// Tailscale (panel.aeis-app.online, ver Caddyfile), nunca por Vercel. A
// diferencia de main.ts, no hay splash ni service worker ni precalentado de
// mapa — nada de eso aplica acá.
mount(AdminApp, {
  target: document.getElementById("app")!,
});
