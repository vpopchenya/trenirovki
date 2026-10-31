// Экран «Тренировка»: одно упражнение на экране, каждый подход сразу в базе. Программу берём со страницы только при
// старте, дальше работаем по копии в записи: выкладка посреди тренировки ничего не меняет.
import { changeWorkout, finishWorkout, getMeta, listWorkouts, saveWorkout, updateSet, type SetField, type Workout, type WorkoutItem, type WorkoutSet } from "./db";
import { filesReminder, myProgram, saveDiaryFile } from "./file";
import { backIcon, barbell, button, countSets, el, goal, groupColor, minutes, numberField, planSets, present, setsLine, setText, type Child, type SetValues } from "./ui";

interface ProgramItem { exerciseId: string; exerciseName: string; group: string; fields: SetField[]; weightLabel: string | null; note: string | null; sets: number; reps: string; rest: string }
interface ProgramDay { name: string; muscles: string; items: ProgramItem[] }
interface Program { id: string; name: string; days: ProgramDay[] }

const page = JSON.parse(document.querySelector("#workout-data")!.textContent!) as { programs: Program[]; health: string };
const root = document.querySelector<HTMLElement>("#workout")!;
const base = import.meta.env.BASE_URL;

const state = {
  screen: "day" as "day" | "work" | "sum",
  program: null as Program | null,
  day: 0,
  workout: null as Workout | null, // незаконченная или только что законченная
  history: [] as Workout[],
  storageOk: true,
  i: 0,
  edit: null as number | null,
  values: {} as SetValues,
  error: "",
  errorText: "", // что сказать, если текущая запись не удалась
  askFinish: false,
  busy: false,
  locked: false, // сразу после подхода: второе нажатие не должно стать лишним подходом
  reminder: false,
  fileNote: null as null | { kind: "okc" | "bad"; text: string },
};

const SET_ERROR = "Подход не записался. Нажми ещё раз. Цифры на месте.";
const SAVE_ERROR = "Не получилось сохранить. Нажми ещё раз, записанное на месте.";
const DOUBLE_TAP_MS = 450;

const unit = (reps: string) => (/сек|повтор/.test(reps) ? reps : `${reps} повторов`);
/** Первое число плана: «6–8» → 6, «30–45 сек» → 30. */
const planStart = (reps: string) => parseInt(reps, 10) || 1;

/** Последняя законченная тренировка с этим упражнением и хотя бы одним подходом, из любой программы. */
function lastSets(exerciseId: string) {
  for (const w of state.history) {
    if (!w.finishedAt) continue;
    const item = w.items.find(x => x.exerciseId === exerciseId && x.sets.length);
    if (item) return item.sets;
  }
  return null;
}

/** Куда вернуться: первое упражнение, где подходы не закончены. */
const position = (w: Workout) => {
  const i = w.items.findIndex(x => !x.skipped && x.sets.length < x.plan.sets);
  return i < 0 ? w.items.length - 1 : i;
};
const item = () => state.workout!.items[state.i];

/** В первом подходе — значения прошлого раза, дальше — предыдущего подхода. Истории нет — начало плана и пустой гриф. */
function prefill() {
  const x = item();
  const past = x.sets.at(-1) ?? lastSets(x.exerciseId)?.[0];
  const start = planStart(x.plan.reps);
  const values: SetValues = {};
  if (x.fields.includes("weight")) values.weight = past?.weight ?? (x.weightLabel?.includes("гриф") ? 20 : 5);
  if (x.fields.includes("reps")) values.reps = past?.reps ?? start;
  if (x.fields.includes("seconds")) values.seconds = past?.seconds ?? start;
  state.values = values;
}

function openExercise(i: number) {
  Object.assign(state, { screen: "work", i, edit: null, error: "", askFinish: false });
  prefill();
  scrollTo(0, 0);
}

/** Запись важнее экрана: подход отмечается только после подтверждения базы, ошибка видна, цифры остаются. */
async function write(action: () => Promise<void>, errorText = SAVE_ERROR) {
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  state.errorText = errorText;
  try {
    await action();
  } catch (err) {
    console.warn(err);
    state.error = state.errorText;
  }
  state.busy = false;
  draw();
}
const change = async (fn: (w: Workout) => void) => { state.workout = await changeWorkout(state.workout!.id, fn); };

function start() {
  const day = state.program!.days[state.day];
  const now = new Date().toISOString();
  const workout: Workout = {
    id: crypto.randomUUID(), programId: state.program!.id, programName: state.program!.name,
    dayIndex: state.day, dayName: day.name, startedAt: now, finishedAt: null, updatedAt: now,
    items: day.items.map((x): WorkoutItem => ({
      exerciseId: x.exerciseId, exerciseName: x.exerciseName, group: x.group, fields: x.fields, weightLabel: x.weightLabel, note: x.note,
      plan: { sets: x.sets, reps: x.reps, rest: x.rest }, skipped: false, sets: [],
    })),
  };
  return write(async () => {
    await saveWorkout(workout);
    state.workout = workout;
    goal("workout_start");
    openExercise(0);
  }).then(() => { if (state.error) { state.error = ""; state.storageOk = false; draw(); } });
}

/** Постоянное хранение просим на первом подходе. Браузер решает сам, отказ покажет дневник. */
const askPersist = () => { navigator.storage?.persist?.().catch(() => {}); };

function next(): Promise<void> | void {
  if (state.i < state.workout!.items.length - 1) openExercise(state.i + 1);
  else return finishNow();
}

const newSet = (): WorkoutSet => ({ weight: state.values.weight ?? null, reps: state.values.reps ?? null, seconds: state.values.seconds ?? null, doneAt: new Date().toISOString() });

function done() {
  const x = item();
  if (state.edit !== null) {
    return write(async () => {
      state.workout = await updateSet(state.workout!.id, state.i, state.edit!, state.values);
      state.edit = null;
      prefill();
    });
  }
  if (x.sets.length >= x.plan.sets) return write(async () => { await next(); });
  return write(async () => {
    const first = countSets(state.workout!) === 0;
    const set = newSet();
    await change(w => { const it = w.items[state.i]; it.sets.push(set); it.skipped = false; });
    state.errorText = SAVE_ERROR; // подход уже в базе: дальше ошибка не про него
    lockDone();
    if (first) askPersist();
    if (item().sets.length < item().plan.sets) prefill();
    else await next();
  }, SET_ERROR);
}

function lockDone() {
  state.locked = true;
  setTimeout(() => {
    state.locked = false;
    root.querySelector<HTMLButtonElement>('[data-testid="set-done"]')?.removeAttribute("disabled");
  }, DOUBLE_TAP_MS);
}

/** С последнего упражнения не уходим молча: законченную тренировку обратно не открыть. */
const skip = () => write(async () => {
  await change(w => { w.items[state.i].skipped = true; });
  if (state.i < state.workout!.items.length - 1) return openExercise(state.i + 1);
  state.askFinish = true;
});

const finish = () => write(finishNow);

async function finishNow() {
  state.askFinish = false;
  state.workout = await finishWorkout(state.workout!.id);
  if (!state.workout) { state.screen = "day"; return; }
  goal("workout_finish");
  state.screen = "sum";
  scrollTo(0, 0);
  try { // запись уже закончена: итог показываем в любом случае
    state.history = await listWorkouts();
    state.reminder = filesReminder(state.history, await getMeta()) !== null;
  } catch (err) {
    console.warn(err);
  }
}

function dayCard(day: ProgramDay) {
  return el("div", { class: "card", "data-testid": "day-card" },
    barbell(day.items),
    el("p", { class: "mutedline" }, day.muscles),
    el("div", {}, ...day.items.map(x => el("div", { class: "ex", style: groupColor(x.group) },
      el("i", { class: "dot" }), el("b", {}, x.exerciseName), el("span", {}, `${x.sets} × ${x.reps}`)))),
    !state.workout && button("done", "start-workout", "Начать тренировку", start));
}

function resumeCard(w: Workout) {
  return el("div", { class: "card calm", "data-testid": "resume" },
    el("p", {}, el("b", {}, "Тренировка не закончена: "), `${w.dayName}, упражнение ${position(w) + 1} из ${w.items.length}, сделано подходов: ${countSets(w)}.`),
    el("div", { class: "row2" },
      button("wbtn", "resume-continue", "Продолжить", () => { openExercise(position(w)); draw(); }),
      button("wbtn ghost", "resume-finish", "Закончить", finish)));
}

const errorCard = () => state.error && el("div", { class: "card bad", "data-testid": "save-error", role: "alert" }, el("p", {}, el("b", {}, state.error)));

const diaryRow = () => el("a", { class: "wrow two", href: `${base}dnevnik/`, "data-testid": "open-diary" },
  el("span", {}, el("b", {}, "Дневник"), el("span", { class: "sub", style: "margin:0" }, `Тренировок: ${state.history.filter(w => w.finishedAt).length}`)),
  el("span", { "aria-hidden": "true", class: "chev" }, "›"));

const storageError = () => !state.storageOk && el("div", { class: "card bad", "data-testid": "storage-error", role: "alert" },
  el("p", {}, el("b", {}, "Записи сейчас не сохранятся. "), "Браузер закрыл доступ к хранилищу, так бывает в приватной вкладке. Открой сайт обычной вкладкой."));

function noProgramView(): Child[] {
  return [
    el("h1", {}, "Сначала выбери ", el("em", { class: "wave" }, "программу")),
    el("p", { "data-testid": "no-program" }, "Тренировка идёт по дням программы. Выбери подходящую, а записи дневника останутся на месте."),
    storageError(),
    el("a", { class: "wbtn", href: `${base}programmy/`, "data-testid": "to-programs" }, "К программам"),
    el("a", { class: "lnk", href: `${base}dnevnik/`, "data-testid": "open-diary" }, "Дневник"),
  ];
}

function dayView(): Child[] {
  const w = state.workout, program = state.program;
  if (!program && !w) return noProgramView();
  const day = program?.days[state.day];
  const others = !w && program ? program.days.map((x, k) => k !== state.day && button("wrow two alt", "other-day",
    [el("span", {}, el("b", {}, x.name), el("span", { class: "sub" }, x.muscles)), barbell(x.items, { small: true })],
    () => { state.day = k; draw(); })) : [];
  return [el("div", { class: "daygrid" },
    el("div", { class: "col" },
      el("p", { class: "eyebrow plain" }, `Моя программа: ${w?.programName ?? program!.name}`),
      el("h1", {}, "Сегодня ", el("em", { class: "wave" }, w?.dayName ?? day!.name)),
      storageError(),
      errorCard(),
      w && resumeCard(w),
      !w && day && dayCard(day)),
    el("div", { class: "col" },
      others.some(Boolean) && el("div", { class: "card" }, el("h2", {}, "Другой день"), el("div", { class: "list" }, ...others)),
      diaryRow(),
      el("p", { class: "warn", "data-testid": "health-warning" }, page.health)))];
}

function setChips(x: WorkoutItem) {
  return Array.from({ length: x.plan.sets }, (_, k) => {
    const s = x.sets[k];
    if (s) return button("st", "set-chip", [`${k + 1}: ${setText(s)} `, el("i", {}, "✓")], () => {
      state.edit = k;
      state.values = { ...(s.weight !== null && { weight: s.weight }), ...(s.reps !== null && { reps: s.reps }), ...(s.seconds !== null && { seconds: s.seconds }) };
      draw();
    }, { "aria-label": `Исправить подход ${k + 1}` });
    return el("span", { class: k === x.sets.length ? "st now" : "st next" }, String(k + 1));
  });
}

function planAside(w: Workout) {
  return el("aside", { class: "aside card", "data-testid": "day-plan" },
    el("h2", {}, w.dayName), barbell(w.items, { cur: state.i }),
    el("div", {}, ...w.items.map((x, k) => el("div", { class: `ex ${k === state.i ? "now" : ""} ${k > state.i ? "soft" : ""}`, style: groupColor(x.group) },
      el("i", { class: "dot" }), el("b", {}, x.exerciseName), el("span", {}, x.skipped && !x.sets.length ? "пропущено" : `${x.sets.length}/${x.plan.sets}`)))));
}

function workView(): Child[] {
  const w = state.workout!, x = item(), total = w.items.length;
  const full = x.sets.length >= x.plan.sets, editing = state.edit !== null, lastEx = state.i === total - 1;
  const setPos = editing ? `Исправляем подход ${state.edit! + 1}` : full ? "Все подходы сделаны" : `Подход ${x.sets.length + 1} из ${x.plan.sets}`;
  const label = editing ? "Сохранить" : full ? (lastEx ? "Закончить тренировку" : "Следующее упражнение") : lastEx && x.sets.length === x.plan.sets - 1 ? "Готово и в итог" : "Готово";
  const past = lastSets(x.exerciseId);
  return [
    el("div", { class: "left", style: `${groupColor(x.group)};--gi:var(--gi-${x.group},#fff)` },
      el("div", { class: "bbtop" }, barbell(w.items, { cur: state.i })),
      el("div", { class: "wtop" },
        button("round", "workout-exit", backIcon(), () => { state.screen = "day"; draw(); }, { "aria-label": "Выйти из тренировки" }),
        el("span", { class: "mono", "data-testid": "exercise-pos" }, `Упражнение ${state.i + 1} из ${total}`),
        x.note && el("span", { class: "tag" }, x.note)),
      el("h1", { class: "name", "data-testid": "exercise-name" }, x.exerciseName),
      errorCard(),
      el("div", { class: "tile", "data-testid": "set-tile" },
        el("div", { class: "tile-h" }, el("b", { "data-testid": "set-pos" }, setPos), el("span", {}, unit(x.plan.reps))),
        (!full || editing) && el("div", { class: "fields" }, ...(Object.keys(state.values) as SetField[]).map(f => numberField(f, state.values, "set", x.weightLabel))),
        past && el("p", { "data-testid": "last-time" }, "В прошлый раз: ", el("b", {}, setsLine(past)))),
      el("div", { class: "sets", "data-testid": "set-list" }, ...setChips(x)),
      editing && button("lnk", "edit-cancel", "Отменить исправление", () => { state.edit = null; prefill(); draw(); }),
      el("div", { class: "dock" }, el("div", {}, button("done", "set-done", label, done, state.locked ? { disabled: "" } : {}))),
      el("div", { class: "more" },
        el("a", { class: "lnk", href: `${base}uprazhneniya/${encodeURIComponent(x.exerciseId)}/`, "data-testid": "technique" }, "Техника"),
        !full && button("lnk", "skip-exercise", "Пропустить упражнение", skip),
        state.i > 0 && button("lnk", "prev-exercise", "‹ Прошлое упражнение", () => { openExercise(state.i - 1); draw(); }),
        state.askFinish
          ? el("div", { class: "card" },
              el("p", {}, `Закончить тренировку? Сделано подходов: ${countSets(w)} из ${planSets(w)}.`, countSets(w) === 0 ? " Пустая тренировка не сохранится." : ""),
              el("div", { class: "row2" },
                button("wbtn danger", "finish-confirm", "Закончить", finish),
                button("wbtn ghost", "finish-cancel", "Продолжить", () => { state.askFinish = false; draw(); })))
          : button("lnk end", "finish-workout", "Закончить тренировку", () => { state.askFinish = true; draw(); }))),
    planAside(w),
  ];
}

function sumView(): Child[] {
  const w = state.workout!;
  const doneItems = w.items.filter(x => x.sets.length), skipped = w.items.filter(x => !x.sets.length);
  const line = (x: WorkoutItem, text: string) => el("div", { class: "ex", style: groupColor(x.group) }, el("i", { class: "dot" }), el("b", {}, x.exerciseName), el("span", {}, text));
  return [el("div", { class: "sumgrid", "data-testid": "summary" },
    el("div", { class: "wide col" },
      el("h1", {}, "Тренировка ", el("em", { class: "wave" }, "готова")),
      el("p", {}, `${w.dayName}, ${w.programName}`),
      barbell(w.items),
      el("div", { class: "stats" },
        el("div", {}, el("b", {}, `${countSets(w)} из ${planSets(w)}`), "подходов"),
        el("div", {}, el("b", {}, `${doneItems.length} из ${w.items.length}`), "упражнений"),
        el("div", {}, el("b", {}, `${minutes(w)} мин`), "времени"))),
    el("div", { class: "card" }, el("h2", {}, "Что сделано"), el("div", {}, ...doneItems.map(x => line(x, setsLine(x.sets))))),
    el("div", { class: "col" },
      skipped.length > 0 && el("div", { class: "card", "data-testid": "summary-skipped" }, el("h2", {}, "Пропущено"), el("div", {}, ...skipped.map(x => line(x, "")))),
      state.reminder && el("div", { class: "card calm", "data-testid": "file-reminder" },
        el("p", {}, el("b", {}, "Сохрани дневник в файл. "), "Записи лежат только в этом браузере. Файл можно отправить себе и потом загрузить обратно."),
        button("wbtn", "reminder-save", "Сохранить в файл", async () => {
          try {
            const name = await saveDiaryFile();
            if (name) { state.reminder = false; state.fileNote = { kind: "okc", text: `Файл сохранён: ${name}` }; goal("diary_export"); }
          } catch (err) {
            console.warn(err);
            state.fileNote = { kind: "bad", text: "Файл не сохранился. Попробуй ещё раз." };
          }
          draw();
        })),
      state.fileNote && el("div", { class: `card ${state.fileNote.kind}`, "data-testid": "file-result", role: "status" }, el("p", {}, state.fileNote.text)),
      el("a", { class: state.reminder ? "wbtn ghost" : "wbtn", href: `${base}dnevnik/`, "data-testid": "to-diary" }, "Открыть дневник")))];
}

function draw() {
  const work = state.screen === "work";
  document.body.classList.toggle("in-work", work);
  root.className = work ? "dv work" : "dv";
  root.replaceChildren(...present(work ? workView() : state.screen === "sum" ? sumView() : dayView()));
  if (work && state.askFinish) root.querySelector('[data-testid="finish-confirm"]')?.scrollIntoView({ block: "center" });
}

async function open() {
  state.program = page.programs.find(p => p.id === myProgram()) ?? null;
  try {
    state.history = await listWorkouts();
    state.workout = state.history.find(w => !w.finishedAt) ?? null;
  } catch (err) {
    console.warn(err);
    state.storageOk = false;
  }
  if (state.program) {
    const last = state.history.find(w => w.finishedAt && w.programId === state.program!.id);
    if (last) state.day = (last.dayIndex + 1) % state.program.days.length;
  }
  draw();
}
open();
