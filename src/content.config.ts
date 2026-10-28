import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import groups from "./data/groups.json";

const groupIds = groups.map(g => g.id) as [string, ...string[]];
const subsOf = Object.fromEntries(groups.map(g => [g.id, g.subs]));

// Одно упражнение — один файл src/content/exercises/<адрес>.json. Имя файла становится адресом страницы.
// Схема строгая: нет техники, ошибок или мелкой группы не из своей группы — сборка падает.
const exercises = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/exercises" }),
  schema: z.object({
    name: z.string().min(3),
    group: z.enum(groupIds),
    sub: z.string(),                       // мелкая группа, которую грузит сильнее всего
    helpers: z.array(z.string()).default([]), // какие мышцы помогают
    equipment: z.array(z.enum(["Штанга", "Гантели", "Скамья", "Турник", "Брусья", "Свой вес"])).min(1),
    level: z.enum(["новичок", "опытный"]),
    sets: z.string(),                      // «3–4 × 6–12»
    rest: z.string(),                      // «1,5–3 мин»
    steps: z.array(z.string().min(1)).min(3),
    errors: z.array(z.string().min(1)).min(2),
    // Пока ролик не подобран — null (в разработке видна заглушка). Сборка для прода без ролика падает.
    video: z.object({
      id: z.string().regex(/^[\w-]{11}$/),
      title: z.string(),
      channel: z.string(),
      lang: z.enum(["ru", "en"]),
    }).nullable(),
    order: z.number().int(),               // порядок в списке группы
  }).refine(e => subsOf[e.group].includes(e.sub), { message: "sub: такой мелкой группы нет в groups.json у этой группы" }),
});

export const collections = { exercises };
