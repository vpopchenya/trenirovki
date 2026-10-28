// Service worker для работы без интернета: после сборки сохраняет на телефоне все страницы, стили, шрифты
// и иконки. Запускается из `npm run build` после `astro build`.
module.exports = {
  globDirectory: "dist/",
  // Из шрифтов — только кириллица и латиница: остальные алфавиты (вьетнамский, греческий…) сайту не нужны,
  // а весят около 2 МБ.
  globPatterns: ["**/*.{html,css,js,svg,png,txt,webmanifest}", "_astro/*-{cyrillic,latin}-[0-9]*.woff2"],
  // Сайт живёт в подпапке /trenirovki/ — к путям файлов из dist добавляем её.
  modifyURLPrefix: { "": "/trenirovki/" },
  // Адрес вида /trenirovki/myshcy/grud/ открывает сохранённый myshcy/grud/index.html.
  directoryIndex: "index.html",
  swDest: "dist/sw.js",
  // Новая версия скачивается в фоне при первом открытии после выкладки и видна со следующего открытия.
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  runtimeCaching: [
    {
      // Картинки-превью роликов: показали один раз — дальше видны и без сети. Грузим их с crossorigin
      // (i.ytimg.com отдаёт CORS), чтобы в кэш шли обычные ответы: «непрозрачные» браузер считает в квоте
      // по мегабайтам и при переполнении может стереть и сохранённые страницы.
      urlPattern: ({ url }) => url.hostname === "i.ytimg.com",
      handler: "CacheFirst",
      options: {
        cacheName: "video-previews",
        expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
        cacheableResponse: { statuses: [200] },
      },
    },
  ],
};
