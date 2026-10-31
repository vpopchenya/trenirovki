// Весь доступ к базе дневника. База — IndexedDB в браузере, на сервер ничего не уходит.
// Запись хранит копию всего, что нужно для показа: правка или удаление программы старые записи не меняет.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type SetField = "weight" | "reps" | "seconds";

/** Пустое значение — поле у этого упражнения не спрашивали. */
export interface WorkoutSet {
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  doneAt: string;
}

export interface WorkoutItem {
  exerciseId: string;
  exerciseName: string;
  group: string; // группа мышц: цвет точки и блина на штанге
  fields: SetField[];
  plan: { sets: number; reps: string; rest: string };
  skipped: boolean;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  programId: string;
  programName: string;
  dayIndex: number;
  dayName: string;
  startedAt: string;
  finishedAt: string | null; // пусто — тренировка не закончена
  updatedAt: string;
  items: WorkoutItem[];
}

/** Настройки дневника. Сколько тренировок после файла не храним, а считаем: счётчик мог бы разойтись с записями. */
export interface Meta {
  lastFileAt: string | null;
  sound: boolean;
}

interface DiaryDB extends DBSchema {
  workouts: { key: string; value: Workout };
  meta: { key: string; value: Meta };
}

const META_KEY = "main";
const DEFAULT_META: Meta = { lastFileAt: null, sound: true };

// Новая схема — только новой версией с переносом в upgrade, старые записи должны открываться всегда.
const DB_VERSION = 1;
let opening: Promise<IDBPDatabase<DiaryDB>> | null = null;

function db() {
  opening ??= openDB<DiaryDB>("trenirovki", DB_VERSION, {
    upgrade(base) {
      base.createObjectStore("workouts", { keyPath: "id" });
      base.createObjectStore("meta");
    },
    // Браузер закрыл соединение (свернули вкладку, почистили) — следующая запись откроет заново, а не упадёт.
    terminated() { opening = null; },
    // Новая версия в другой вкладке ждёт, пока эта отпустит базу.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
      opening = null;
    },
  }).catch(err => {
    opening = null; // следующая попытка откроет заново: причина могла пройти
    throw err;
  });
  return opening;
}

/** Новые сверху. Время — ISO-строки, сравниваем их как текст. */
export async function listWorkouts() {
  const all = await (await db()).getAll("workouts");
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function getWorkout(id: string) {
  return (await db()).get("workouts", id);
}

export async function saveWorkout(workout: Workout) {
  await (await db()).put("workouts", { ...workout, updatedAt: new Date().toISOString() });
}

/** Меняет один подход, перечитав запись в той же операции: другая вкладка могла за это время дописать подходы. */
export async function updateSet(id: string, item: number, set: number, change: Partial<WorkoutSet>) {
  const tx = (await db()).transaction("workouts", "readwrite");
  const workout = await tx.store.get(id);
  const target = workout?.items[item]?.sets[set];
  if (!workout || !target) throw new Error("Запись изменилась, подхода уже нет");
  Object.assign(target, change);
  await tx.store.put({ ...workout, updatedAt: new Date().toISOString() });
  await tx.done;
}

export async function deleteWorkout(id: string) {
  await (await db()).delete("workouts", id);
}

export async function clearWorkouts() {
  await (await db()).clear("workouts");
}

export interface MergeResult { added: number; updated: number; same: number }

/** Склейка по id: новой записи нет — добавляем, есть — остаётся более поздняя. Удалений нет. Одна операция: посреди не оборвётся. */
export async function mergeWorkouts(incoming: Workout[]) {
  const tx = (await db()).transaction("workouts", "readwrite");
  const result: MergeResult = { added: 0, updated: 0, same: 0 };
  for (const workout of incoming) {
    const existing = await tx.store.get(workout.id);
    if (!existing) result.added++;
    else if (workout.updatedAt > existing.updatedAt) result.updated++;
    else { result.same++; continue; }
    await tx.store.put(workout);
  }
  await tx.done;
  return result;
}

export async function getMeta(): Promise<Meta> {
  return { ...DEFAULT_META, ...await (await db()).get("meta", META_KEY) };
}

export async function updateMeta(change: Partial<Meta>) {
  await (await db()).put("meta", { ...await getMeta(), ...change }, META_KEY);
}
