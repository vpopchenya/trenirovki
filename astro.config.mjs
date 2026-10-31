import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

// Страницы, которых нет в поиске: личные записи человека, искать там нечего.
const hidden = ["/404", "/dnevnik/", "/trenirovka/"];

// Сайт живёт на GitHub Pages в подпапке репозитория. Свой домен — перед открытием для всех.
export default defineConfig({
  site: "https://vpopchenya.github.io",
  base: "/trenirovki",
  trailingSlash: "always",
  integrations: [sitemap({ filter: page => !hidden.some(path => page.includes(path)) })],
});
