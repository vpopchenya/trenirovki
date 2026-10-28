import { defineConfig } from "astro/config";

// Сайт живёт на GitHub Pages в подпапке репозитория. Свой домен — перед открытием для всех.
export default defineConfig({
  site: "https://vpopchenya.github.io",
  base: "/trenirovki",
  trailingSlash: "always",
});
