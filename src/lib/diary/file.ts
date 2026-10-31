// Файл дневника: единственный способ перенести записи на другой телефон и сохранить их. Загрузка только добавляет.
import { MY_PROGRAM_KEY } from "../storage-keys";
import { listWorkouts, mergeWorkouts, updateMeta, type MergeResult, type Meta, type RestState, type SetField, type Workout, type WorkoutItem, type WorkoutSet } from "./db";

const APP = "karmannyj-trener";
const FORMAT = 1;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const LIMITS = {
  weight: { min: 0, max: 500 },
  reps: { min: 1, max: 200 },
  seconds: { min: 1, max: 3600 },
} satisfies Record<SetField, { min: number; max: number }>;

const BAD_FILE = "Файл не подошёл, это не файл дневника. В дневнике ничего не изменилось.";
const DAMAGED_FILE = "В файле ошибка, он повреждён или изменён. В дневнике ничего не изменилось.";
const NEWER_FILE = "Файл из новой версии приложения. Обнови страницу и загрузи снова. В дневнике ничего не изменилось.";
const BIG_FILE = "Файл слишком большой, больше 5 МБ. Это не файл дневника. В дневнике ничего не изменилось.";

export interface DiaryFile { myProgram: string | null; workouts: Workout[] }
export type ParseResult = ({ ok: true } & DiaryFile) | { ok: false; message: string };

class Damaged extends Error {}

function check(condition: unknown): asserts condition {
  if (!condition) throw new Damaged();
}
const text = (v: unknown, max = 200) => {
  check(typeof v === "string" && v.length > 0 && v.length <= max);
  return v as string;
};
const time = (v: unknown) => {
  check(typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)));
  return new Date(v as string).toISOString(); // один вид записи: при склейке и сортировке время сравниваем как текст
};
const count = (v: unknown, max: number) => {
  check(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max);
  return v as number;
};
const list = (v: unknown, max: number) => {
  check(Array.isArray(v) && v.length <= max);
  return v as Record<string, unknown>[];
};
const record = (v: unknown) => {
  check(typeof v === "object" && v !== null && !Array.isArray(v));
  return v as Record<string, unknown>;
};
/** Заполнены ровно те поля, что спрашивали у упражнения: иначе подход нечем показать и нельзя исправить. */
function value(v: unknown, field: SetField, asked: SetField[]) {
  if (!asked.includes(field)) {
    check(v === null);
    return null;
  }
  check(typeof v === "number" && v >= LIMITS[field].min && v <= LIMITS[field].max);
  check(field === "weight" || Number.isInteger(v));
  return v as number;
}

// Из файла берём только известные поля и собираем запись заново: файл мог прийти от кого угодно.
function readSet(raw: unknown, asked: SetField[]): WorkoutSet {
  const s = record(raw);
  return { weight: value(s.weight, "weight", asked), reps: value(s.reps, "reps", asked), seconds: value(s.seconds, "seconds", asked), doneAt: time(s.doneAt) };
}

function readItem(raw: unknown): WorkoutItem {
  const i = record(raw);
  const plan = record(i.plan);
  check(typeof i.skipped === "boolean");
  check(typeof i.group === "string" && /^[a-z]{1,20}$/.test(i.group)); // попадает в имя переменной CSS
  const fields = list(i.fields, 3) as unknown as SetField[];
  check(fields.length > 0 && fields.every(f => typeof f === "string" && Object.hasOwn(LIMITS, f)));
  return {
    exerciseId: text(i.exerciseId), exerciseName: text(i.exerciseName), group: i.group as string, fields,
    weightLabel: i.weightLabel == null ? null : text(i.weightLabel), note: i.note == null ? null : text(i.note),
    plan: { sets: count(plan.sets, 50), reps: text(plan.reps), rest: text(plan.rest) },
    skipped: i.skipped as boolean, sets: list(i.sets, 100).map(s => readSet(s, fields)),
  };
}

function readRest(raw: unknown, items: number): RestState {
  const r = record(raw);
  const rest = { endsAt: time(r.endsAt), total: count(r.total, 7200), from: count(r.from, 50), to: count(r.to, 50) };
  check(rest.total > 0 && rest.from < items && rest.to < items);
  return rest;
}

function readWorkout(raw: unknown): Workout {
  const w = record(raw);
  check(typeof w.id === "string" && /^[\w-]{1,64}$/.test(w.id)); // попадает в адрес страницы
  check(Array.isArray(w.items) && w.items.length > 0);
  return {
    id: w.id as string, programId: text(w.programId), programName: text(w.programName),
    dayIndex: count(w.dayIndex, 50), dayName: text(w.dayName),
    startedAt: time(w.startedAt), finishedAt: w.finishedAt === null ? null : time(w.finishedAt), updatedAt: time(w.updatedAt),
    rest: w.rest == null ? null : readRest(w.rest, w.items.length),
    items: list(w.items, 50).map(readItem),
  };
}

/** Проверяет файл целиком, ещё ничего не записывая. Ошибка хоть в одной записи — не берём ничего. */
export function parseDiaryFile(content: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(content); } catch { return { ok: false, message: BAD_FILE }; }
  if (typeof raw !== "object" || raw === null) return { ok: false, message: BAD_FILE };
  const file = raw as Record<string, unknown>;
  if (file.app !== APP || !Number.isInteger(file.format) || (file.format as number) < 1) return { ok: false, message: BAD_FILE };
  if ((file.format as number) > FORMAT) return { ok: false, message: NEWER_FILE };
  try {
    const myProgram = file.myProgram === null ? null : text(file.myProgram);
    return { ok: true, myProgram, workouts: list(file.workouts, 100_000).map(readWorkout) };
  } catch (err) {
    if (err instanceof Damaged) return { ok: false, message: DAMAGED_FILE };
    throw err;
  }
}

export function myProgram() {
  try { return localStorage.getItem(MY_PROGRAM_KEY); } catch { return null; } // хранилище закрыто: как будто не выбрана
}

function chooseProgramIfNone(id: string) {
  try { if (!localStorage.getItem(MY_PROGRAM_KEY)) localStorage.setItem(MY_PROGRAM_KEY, id); } catch {}
}

/** Дата по часам телефона: имя файла должно совпадать с днём, который видит человек. */
function fileName(now: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `trener-dnevnik-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** На компьютере Chrome тоже умеет «Поделиться», но там человек ждёт обычное скачивание.
 *  Не все телефоны делятся .json, поэтому запасной вариант — тот же файл как .txt, загрузка берёт оба. */
function shareableFile(file: File, json: string) {
  if (!matchMedia("(pointer: coarse)").matches || !navigator.canShare) return null;
  const asText = new File([json], file.name.replace(/json$/, "txt"), { type: "text/plain" });
  return [file, asText].find(f => navigator.canShare({ files: [f] })) ?? null;
}

/** Возвращает имя файла, либо null, если человек отменил меню «Поделиться»: это не считается сохранением. */
export async function saveDiaryFile() {
  const now = new Date();
  const content = { app: APP, format: FORMAT, exportedAt: now.toISOString(), myProgram: myProgram(), workouts: await listWorkouts() };
  const json = JSON.stringify(content);
  const file = new File([json], fileName(now), { type: "application/json" });
  const toShare = shareableFile(file, json);
  if (toShare) {
    try {
      await navigator.share({ files: [toShare] });
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return null;
      download(file); // меню не открылось: файл важнее способа
    }
  } else {
    download(file);
  }
  await updateMeta({ lastFileAt: now.toISOString() });
  return file.name;
}

/** Спокойное напоминание: после первой законченной тренировки и дальше через каждые 5. Вернёт, сколько прошло, или null. */
export function filesReminder(workouts: Workout[], meta: Meta) {
  const finished = workouts.filter(w => w.finishedAt);
  const since = meta.lastFileAt ? finished.filter(w => w.finishedAt! > meta.lastFileAt!).length : finished.length;
  return since >= (meta.lastFileAt ? 5 : 1) ? since : null;
}

export type LoadResult = ({ ok: true } & MergeResult) | { ok: false; message: string };

export async function loadDiaryFile(file: File): Promise<LoadResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: BIG_FILE };
  const parsed = parseDiaryFile(await file.text());
  if (!parsed.ok) return parsed;
  const merged = await mergeWorkouts(parsed.workouts);
  if (parsed.myProgram) chooseProgramIfNone(parsed.myProgram);
  return { ok: true, ...merged };
}
