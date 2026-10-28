import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Сайт живёт на GitHub Pages в подпапке репозитория. Свой домен — перед открытием для всех.
export default defineConfig({
  site: "https://vpopchenya.github.io",
  base: "/trenirovki",
  trailingSlash: "always",
  integrations: [sitemap({ filter: page => !page.includes("/404") })],
});
