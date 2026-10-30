import { getCollection, getEntry } from "astro:content";
import groups from "../data/groups.json";

export type Group = (typeof groups)[number];
export type Side = "front" | "back";

const LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "j", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "",
  ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
/** «Середина спины» → «seredina-spiny»: адрес страницы мелкой группы. */
export const slugify = (s: string) =>
  [...s.toLowerCase()].map(c => LAT[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Упражнения группы по порядку. */
export async function exercisesOf(groupId: string) {
  const list = await getCollection("exercises", e => e.data.group === groupId);
  return list.sort((a, b) => a.data.order - b.data.order);
}

/** Мелкие группы, для которых уже есть упражнения: только у них есть своя страница. */
export async function subsWithExercises(group: Group) {
  const list = await exercisesOf(group.id);
  return group.subs.filter(s => list.some(e => e.data.sub === s));
}

/** Слово в нужной форме для числа: 1 неделя, 2 недели, 5 недель. */
const pluralize = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

export const plural = (n: number) => pluralize(n, "упражнение", "упражнения", "упражнений");
export const pluralWeeks = (n: number) => pluralize(n, "неделя", "недели", "недель");

/** Разметка «хлебных крошек» для поисковиков: [название, путь от корня сайта]. */
export const breadcrumbs = (site: URL, items: [string, string][]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: new URL(path, site).href })),
});

/** Что бывает дома и в дороге: по этому списку работает фильтр «Без зала». */
export const HOME_EQUIPMENT = ["Резинка", "Свой вес"];
export const isHome = (equipment: string[]) => equipment.every(x => HOME_EQUIPMENT.includes(x));
/** Общая для всех упражнений с резинкой ошибка: страница добавляет её сама, в файлах упражнений не повторяем. */
export const BAND_SAFETY = "Плохо закреплённая или надорванная резинка — может сорваться и ударить. Перед подходом проверь узел и саму резинку";

export const levelClass = (level: string) => (level === "новичок" ? "lvl1" : "lvl2");

export const HEALTH_WARNING = "Мы не врачи. Есть болезни или травмы — сначала к врачу или тренеру.";
/** Общее для всех программ правило: на странице одно на всех, в файлах программ не повторяем. */
export const PROGRESS_RULE = "Сделал все подходы на верхней границе повторений — в следующий раз возьми чуть больше вес. Упражнения без веса: добавь повторы или секунды.";
export const REST_RULE = "Между тренировками — минимум день отдыха: мышцы растут и восстанавливаются, пока ты отдыхаешь.";
export const HEAVY_WARNING = "Тяжёлые веса — только со страховкой.";
/** У всех программ на похудение: на шаге «Основы» сюда добавится ссылка на питание. */
export const FAT_LOSS_NOTE = "Честно: сами тренировки вес почти не снижают, результат даёт питание. Программа помогает сохранить мышцы, пока худеешь.";

/** Ключ localStorage: имя файла выбранной программы. Хранится только на телефоне, на сервер не уходит. */
export const MY_PROGRAM_KEY = "my-program";

/** Программы по порядку, с упражнениями вместо ссылок. Сюда же — проверки, которых не выразить схемой. */
export async function allPrograms() {
  const list = await getCollection("programs");
  const views = await Promise.all(list.map(async p => {
    const days = await Promise.all(p.data.days.map(async day => {
      const items = await Promise.all(day.items.map(async item => ({ ...item, ex: (await getEntry(item.exercise))! })));
      // Новичку нельзя выдать опытное упражнение: страховки и опыта у него нет, а текст программы этого не остановит.
      const hard = items.find(i => p.data.level === "новичок" && i.ex.data.level === "опытный");
      if (hard) throw new Error(`Программа «${p.data.name}»: упражнение «${hard.ex.data.name}» только для опытных`);
      const dayGroups = items.map(i => i.ex.data.group);
      return { name: day.name, items, groups: dayGroups, muscles: [...new Set(dayGroups)].map(id => groups.find(g => g.id === id)!.name.toLowerCase()).join(" · ") };
    }));
    const focusGroup = groups.find(g => g.id === p.data.focus);
    return { id: p.id, ...p.data, days, focusText: focusGroup && `упор на ${focusGroup.acc}` };
  }));
  return views.sort((a, b) => a.order - b.order);
}
