// Правила про группы мышц без astro:content — их можно импортировать и в <script> для браузера.
import groups from "../data/groups.json";

type Group = (typeof groups)[number];

/** «Квадрицепс · Икры»: неразрывный пробел перед точкой, чтобы «·» не переносилась в начало строки. */
export const subsText = (g: Group) => g.subs.join(" · ");

/** Какой стороной показать фигуру для мелкой группы: трицепс и т. п. видно только сзади (backSubs). */
export const sideOf = (g: Group, sub: string) => (g.backSubs?.includes(sub) ? "back" : g.side) as "front" | "back";
