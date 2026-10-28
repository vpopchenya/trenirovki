import { getCollection } from "astro:content";
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

export const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "упражнение" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "упражнения" : "упражнений";

export const levelClass = (level: string) => (level === "новичок" ? "lvl1" : "lvl2");
