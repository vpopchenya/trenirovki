// Блок «Твоя история» на странице упражнения. Рисуем только в браузере: для поиска страница не меняется.
import { listWorkouts } from "./db";
import { dayMonth, el, exerciseHistory, setsLine } from "./ui";

const LIMIT = 5;

export async function showHistory(box: HTMLElement) {
  let rows: ReturnType<typeof exerciseHistory> = [];
  try {
    rows = exerciseHistory(await listWorkouts(), box.dataset.exercise!).slice(0, LIMIT);
  } catch (err) {
    console.warn(err); // база закрыта: страница техники работает и без истории
  }
  box.replaceChildren(...rows.length ? [el("section", { "data-testid": "exercise-history" },
    el("h2", {}, "Твоя история"),
    el("ul", {}, ...rows.map(r => el("li", { "data-testid": "history-row" }, el("span", {}, dayMonth(r.startedAt)), el("b", {}, setsLine(r.sets))))))] : []);
}
