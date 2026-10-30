import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import groups from "./data/groups.json";

const groupIds = groups.map(g => g.id) as [string, ...string[]];
const subsOf = Object.fromEntries(groups.map(g => [g.id, g.subs]));
// Опечатка в backSubs молча показала бы фигуру не той стороной — пусть лучше падает сборка.
for (const g of groups) for (const s of g.backSubs ?? [])
  if (!g.subs.includes(s)) throw new Error(`groups.json: у «${g.name}» в backSubs нет такой мелкой группы: «${s}»`);

// Одно упражнение — один файл src/content/exercises/<адрес>.json. Имя файла становится адресом страницы.
// Схема строгая: нет техники, ошибок или мелкой группы не из своей группы — сборка падает.
const exercises = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/exercises" }),
  schema: z.object({
    name: z.string().min(3),
    group: z.enum(groupIds),
    sub: z.string(),                       // мелкая группа, которую грузит сильнее всего
    helpers: z.array(z.string()).default([]), // какие мышцы помогают
    equipment: z.array(z.enum(["Штанга", "Гантели", "Скамья", "Турник", "Брусья", "Свой вес", "Резинка"])).min(1),
    // Как сделать то же без резинки — у тех, кто только начинает дома, её часто нет.
    noBand: z.string().min(10).optional(),
    level: z.enum(["новичок", "опытный"]),
    sets: z.string(),                      // «3–4 × 6–12»
    rest: z.string(),                      // «1,5–3 мин»
    steps: z.array(z.string().min(1)).min(3),
    errors: z.array(z.string().min(1)).min(2),
    // Ролики разных авторов, чтобы человек выбрал, у кого понятнее. Первый показывается по умолчанию —
    // ставим лучший: несколько ракурсов, коротко, хорошие отзывы. Название и канал — как на YouTube (oEmbed).
    videos: z.array(z.object({
      id: z.string().regex(/^[\w-]{11}$/),
      author: z.string().max(24),              // короткое имя для кнопки «Кто показывает»
      title: z.string(),
      channel: z.string(),
      lang: z.enum(["ru", "en"]),
    })).min(1).max(3),
    order: z.number().int(),               // порядок в списке группы
  }).refine(e => subsOf[e.group].includes(e.sub), { message: "sub: такой мелкой группы нет в groups.json у этой группы" })
    // Замена резинке нужна ровно тем, кому нужна резинка: забыли или поставили штанге — пусть падает сборка.
    .refine(e => e.equipment.includes("Резинка") === !!e.noBand, { message: "noBand: нужен у упражнений с резинкой и только у них" }),
});

export const collections = { exercises };
