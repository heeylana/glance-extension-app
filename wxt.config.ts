import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// Pin the extension ID across builds and machines, so the backend's ALLOWED_ORIGINS can name it.
// Chrome only accepts the key as one line of base64: a key pasted from the Web Store dashboard comes wrapped
// (and sometimes with PEM headers), and a single newline made Chrome refuse the whole manifest
// ("Value 'key' is missing or invalid"). Keep only the base64.
const pubkeyPath = fileURLToPath(new URL("./.keys/extension-pubkey.txt", import.meta.url));
const extensionKey = existsSync(pubkeyPath)
  ? readFileSync(pubkeyPath, "utf8").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "") || undefined
  : undefined;

// The WXT_* values reach the bundle through Vite, but not this file's process.env: read .env here too, so
// host_permissions name the real backend and console instead of localhost. Values already set win.
try {
  process.loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
} catch {
  /* no .env: the environment only */
}
const BACKEND = process.env.WXT_BACKEND_URL ?? "http://localhost:8787";
const CONSOLE = process.env.WXT_CONSOLE_URL ?? "http://localhost:5173";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "dist",
  manifest: ({ mode }) => ({
    name: "Glance",
    short_name: "Glance",
    description: "Buy from the headline. Any stock, from any page, in seconds.",
    minimum_chrome_version: "116",
    ...(extensionKey ? { key: extensionKey } : {}),
    // offscreen: the push-to-talk recorder, so the microphone belongs to the extension rather than the page.
    permissions: ["storage", "sidePanel", "activeTab", "tabs", "offscreen"],
    // <all_urls>: "show me" screenshots the tab after a voice take, which carries no activeTab grant. The content
    // script already runs on every site, so Chrome's permission warning does not change.
    host_permissions: [`${new URL(BACKEND).origin}/*`, `${new URL(CONSOLE).origin}/*`, "<all_urls>"],
    action: { default_title: "Glance" },
    // The bubble loads the bundled fonts into pages; nothing else is exposed.
    web_accessible_resources: [{ resources: ["fonts/*.woff2"], matches: ["http://*/*", "https://*/*"] }],
    commands: {
      glance: {
        suggested_key: { default: "Alt+G", mac: "Alt+G" },
        description: "Glance this page",
      },
    },
    ...(mode === "production"
      ? { content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'; frame-ancestors 'none';" } }
      : {}),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
    // The output dir lives inside the project; keep Vite's dependency scan off dist/**/*.html.
    optimizeDeps: { entries: ["entrypoints/**/*.html", "entrypoints/**/*.ts", "entrypoints/**/*.tsx"] },
  }),
});
