import { defineCollection, reference } from "astro:content";
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

// Одна программа — один файл src/content/programs/<адрес>.json. Имя файла менять нельзя: это адрес страницы,
// а на этапе 3 на него сошлётся дневник. Подходы и повторы живут здесь, а не в упражнении: у силы и набора они разные.
const programs = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/programs" }),
  schema: z.object({
    name: z.string().min(3),
    description: z.string().min(20),       // для поиска и подписи на странице программы
    goal: z.enum(["набор", "сила", "похудение"]),
    level: z.enum(["новичок", "опытный"]),
    daysPerWeek: z.union([z.literal(2), z.literal(3)]),
    focus: z.enum(groupIds).optional(),    // программа с упором на группу мышц
    tier: z.enum(["free", "pro"]),         // заранее отмечаем платное; пока нигде не показываем и не закрываем
    weeks: z.number().int().positive(),
    days: z.array(z.object({
      name: z.string().min(1),
      items: z.array(z.object({
        exercise: reference("exercises"),  // опечатка в имени упражнения — сборка падает
        sets: z.number().int().positive(),
        reps: z.string().min(1),           // «8–12» или «30–45 сек»
        rest: z.string().min(1),
        note: z.string().optional(),
      })).min(1),
    })).min(1),
    order: z.number().int(),               // порядок в списке программ
  }).refine(p => p.days.length === p.daysPerWeek, { message: "days: число дней должно совпадать с daysPerWeek" }),
});

export const collections = { exercises, programs };
