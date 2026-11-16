// ENGINE. Website settings live in settings/config.js; this fills the page head (title, link previews) from it.
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import config from "./settings/config.js";

const escape = (text) => String(text ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** %APP_NAME%, %APP_TAGLINE%, %APP_DESCRIPTION%, %SITE_URL% in index.html ← settings/config.js app */
const pageHead = () => ({
    name: "settings-page-head",
    transformIndexHtml: (html) => html
        .replaceAll("%APP_NAME%", escape(config.app?.name))
        .replaceAll("%APP_TAGLINE%", escape(config.app?.tagline))
        .replaceAll("%APP_DESCRIPTION%", escape(config.app?.description))
        .replaceAll("%SITE_URL%", escape(String(config.app?.siteUrl ?? "").replace(/\/+$/, ""))),
});

export default defineConfig({
    plugins: [ tailwindcss(), pageHead() ],
});
