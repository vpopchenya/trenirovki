// Общее для экранов дневника и тренировки. Текст записей может прийти из чужого файла, поэтому разметку строим
// только через el(): всё попадает как текст.
import type { SetField, Workout, WorkoutItem, WorkoutSet } from "./db";
import { LIMITS } from "./file";

export type Child = Node | string | null | false;
type Attrs = Record<string, string | ((ev: Event) => void)>;

export const present = (children: Child[]) => children.filter((c): c is Node | string => c !== null && c !== false);

export function el(tag: string, attrs: Attrs = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (typeof val === "function") node.addEventListener(key, val);
    else node.setAttribute(key, val);
  }
  node.append(...present(children));
  return node;
}
export const button = (cls: string, testid: string, label: Child | Child[], onClick: () => void, attrs: Attrs = {}) =>
  el("button", { type: "button", class: cls, "data-testid": testid, click: onClick, ...attrs }, ...[label].flat());
export const groupColor = (group: string) => `--gc:var(--g-${group},var(--muted))`;
export const goal = (name: string) => dispatchEvent(new CustomEvent("goal", { detail: name }));

export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
export const decimal = (v: number) => String(v).replace(".", ",");

export function setText(s: WorkoutSet) {
  if (s.seconds !== null) return `${s.seconds} сек`;
  return s.weight === null ? `${s.reps} раз` : `${decimal(s.weight)} кг × ${s.reps}`;
}
/** Один вес на все подходы — коротко: «40 кг × 8, 8, 7». Разный вес — каждый подход целиком. */
export function setsLine(sets: WorkoutSet[]) {
  const [first] = sets;
  if (first.seconds !== null) return `${sets.map(s => s.seconds).join(", ")} сек`;
  const reps = sets.map(s => s.reps).join(", ");
  if (first.weight === null) return `${reps} раз`;
  return sets.every(s => s.weight === first.weight) ? `${decimal(first.weight)} кг × ${reps}` : sets.map(setText).join(", ");
}
export const countSets = (w: Workout) => w.items.reduce((n, x) => n + x.sets.length, 0);
export const planSets = (w: Workout) => w.items.reduce((n, x) => n + x.plan.sets, 0);
export const minutes = (w: Workout) => w.finishedAt && Math.max(1, Math.round((Date.parse(w.finishedAt) - Date.parse(w.startedAt)) / 60000));

export function backIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = '<path d="M15 5l-7 7 7 7"/>';
  return icon;
}

/** День штангой: cur — до какого упражнения блины цветные, будущие серые. */
export function barbell(items: Pick<WorkoutItem, "group">[], { cur = Infinity, small = false } = {}) {
  const plate = (x: Pick<WorkoutItem, "group">, i: number) => el("i", {
    class: i > cur ? "off" : "",
    style: `${groupColor(x.group)};height:${Math.max((small ? 26 : 34) - i * (small ? 3 : 4), 6)}px`,
  });
  return el("div", { class: small ? "bb small" : "bb", "aria-hidden": "true", "data-testid": "barbell" },
    ...items.map(plate), el("span"), ...items.map(plate).reverse());
}

const FIELD_LABEL: Record<SetField, string> = { weight: "Вес, кг", reps: "Повторы", seconds: "Секунды" };
const FIELD_STEP: Record<SetField, number> = { weight: 2.5, reps: 1, seconds: 5 };
const clamp = (v: number, field: SetField) => Math.min(LIMITS[field].max, Math.max(LIMITS[field].min, v));

export type SetValues = Partial<Record<SetField, number>>;

/** Поле с кнопками ±: пишет прямо в values. Запятая и точка работают обе, число держим в границах. */
export function numberField(field: SetField, values: SetValues, prefix: string, weightLabel?: string | null) {
  const id = `${prefix}-${field}`;
  const parse = (target: HTMLInputElement) => {
    const n = parseFloat(target.value.replace(",", "."));
    if (!Number.isNaN(n)) values[field] = clamp(field === "weight" ? n : Math.round(n), field);
  };
  const input = el("input", {
    class: "num", id, "data-testid": id, inputmode: "decimal", value: decimal(values[field]!),
    input: ev => parse(ev.target as HTMLInputElement),
    change: ev => { (ev.target as HTMLInputElement).value = decimal(values[field]!); },
  }) as HTMLInputElement;
  const adjust = (by: number) => () => {
    values[field] = clamp(values[field]! + by, field);
    input.value = decimal(values[field]!);
  };
  return el("div", { class: "field" }, el("label", { for: id }, field === "weight" && weightLabel || FIELD_LABEL[field]), input,
    el("div", { class: "steps" },
      button("step", `${id}-minus`, "−", adjust(-FIELD_STEP[field]), { "aria-label": "Меньше" }),
      button("step", `${id}-plus`, "+", adjust(FIELD_STEP[field]), { "aria-label": "Больше" })));
}
