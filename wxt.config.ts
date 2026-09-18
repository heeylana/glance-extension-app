import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// Pin the extension ID across builds and machines (needed for Privy's allowed-domain and OAuth redirect settings).
const pubkeyPath = fileURLToPath(new URL("./.keys/extension-pubkey.txt", import.meta.url));
const extensionKey = existsSync(pubkeyPath) ? readFileSync(pubkeyPath, "utf8").trim() : undefined;

const BACKEND = process.env.WXT_BACKEND_URL ?? "http://localhost:8787";
const CONSOLE = process.env.WXT_CONSOLE_URL ?? "http://localhost:5173";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: "dist",
  manifest: ({ mode }) => ({
    name: "Glance",
    short_name: "Glance",
    description: "Buy from the headline. Any stock, from any page, in seconds.",
    version: "0.1.0",
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
