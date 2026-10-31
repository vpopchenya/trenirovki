// Экран «Тренировка»: одно упражнение на экране, каждый подход сразу в базе. Программу берём со страницы только при
// старте, дальше работаем по копии в записи: выкладка посреди тренировки ничего не меняет.
import { changeWorkout, finishWorkout, getMeta, listWorkouts, saveWorkout, updateMeta, updateSet, type SetField, type Workout, type WorkoutItem, type WorkoutSet } from "./db";
import { filesReminder, myProgram, saveDiaryFile } from "./file";
import { keepScreenOn, mmss, restSeconds, secondsLeft, signal, unlockAudio } from "./timer";
import { backIcon, button, countSets, dayBar, el, exerciseHistory, goal, groupColor, minutes, numberField, planSets, present, setsLine, setText, type Child, type SetValues } from "./ui";

interface ProgramItem { exerciseId: string; exerciseName: string; group: string; fields: SetField[]; weightLabel: string | null; note: string | null; sets: number; reps: string; rest: string }
interface ProgramDay { name: string; muscles: string; items: ProgramItem[] }
interface Program { id: string; name: string; days: ProgramDay[] }

const page = JSON.parse(document.querySelector("#workout-data")!.textContent!) as { programs: Program[]; care: string };
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
  peek: false, // с отдыха открыли упражнение: исправить подход или посмотреть технику, таймер идёт
  signaled: false,
  sound: true,
  noWake: false,
  locked: false, // сразу после подхода: второе нажатие не должно стать лишним подходом
  reminder: false,
  fileNote: null as null | { kind: "okc" | "bad"; text: string },
};

const SET_ERROR = "Подход не записался. Нажми ещё раз. Цифры на месте.";
const SAVE_ERROR = "Не получилось сохранить. Нажми ещё раз, записанное на месте.";
const DOUBLE_TAP_MS = 450;
const REST_FALLBACK = 90; // запись из чужого файла с непонятным отдыхом
const REST_STEP = 15;

const unit = (reps: string) => (/сек|повтор/.test(reps) ? reps : `${reps} повторов`);
/** Первое число плана: «6–8» → 6, «30–45 сек» → 30. */
const planStart = (reps: string) => parseInt(reps, 10) || 1;

const lastSets = (exerciseId: string) => exerciseHistory(state.history, exerciseId)[0]?.sets ?? null;

/** Куда вернуться: первое упражнение, где подходы не закончены. */
const position = (w: Workout) => {
  if (w.rest) return w.rest.to;
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
  unlockAudio();
  const x = item();
  if (state.edit !== null) {
    return write(async () => {
      state.workout = await updateSet(state.workout!.id, state.i, state.edit!, state.values);
      state.edit = null;
      if (state.peek) { state.peek = false; state.i = state.workout!.rest!.to; lockDone(); }
      prefill();
    });
  }
  if (x.sets.length >= x.plan.sets) return write(async () => {
    await change(w => { w.rest = null; });
    state.peek = false;
    await next();
  });
  return write(async () => {
    const first = countSets(state.workout!) === 0;
    const set = newSet();
    const from = state.i, full = x.sets.length + 1 >= x.plan.sets;
    const to = full ? from + 1 : from;
    const total = restSeconds(x.plan.rest) ?? REST_FALLBACK;
    const lastSet = full && to >= state.workout!.items.length; // после последнего подхода тренировки таймера нет
    await change(w => {
      const it = w.items[from];
      it.sets.push(set);
      it.skipped = false;
      w.rest = lastSet ? null : { endsAt: new Date(Date.now() + total * 1000).toISOString(), total, from, to };
    });
    state.errorText = SAVE_ERROR; // подход уже в базе: дальше ошибка не про него
    lockDone();
    if (first) askPersist();
    state.peek = false;
    state.signaled = false;
    if (lastSet) return finishNow();
    openExercise(to);
  }, SET_ERROR);
}

const leaveRest = () => write(async () => {
  const to = state.workout!.rest!.to;
  await change(w => { w.rest = null; });
  lockDone(); // на этом месте появляется «Готово»: второе касание не должно стать подходом
  state.peek = false;
  openExercise(to);
});

const shiftRest = (seconds: number) => write(async () => {
  unlockAudio();
  await change(w => {
    const rest = w.rest!;
    rest.endsAt = new Date(Date.parse(rest.endsAt) + seconds * 1000).toISOString();
    if (seconds > 0) rest.total += seconds;
  });
});

function peekSet() {
  state.peek = true;
  openExercise(state.workout!.rest!.from);
  draw();
}

function unpeek() {
  state.peek = false;
  openExercise(state.workout!.rest!.to);
  draw();
}

async function toggleSound() {
  state.sound = !state.sound;
  try { await updateMeta({ sound: state.sound }); } catch (err) { console.warn(err); }
  draw();
}

function lockDone() {
  state.locked = true;
  setTimeout(() => {
    state.locked = false;
    root.querySelector("[data-lock]")?.removeAttribute("disabled");
  }, DOUBLE_TAP_MS);
}

/** С последнего упражнения не уходим молча: законченную тренировку обратно не открыть. */
const skip = () => write(async () => {
  await change(w => { w.items[state.i].skipped = true; w.rest = null; });
  state.peek = false;
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

/** Строка маршрута дня: цветной кружок с номером, у сделанного — галочка. */
function routeRow(group: string, n: number, name: string, meta: string, done: boolean) {
  return el("li", { class: done ? "wr ok" : "wr", "data-testid": "route-row", style: `${groupColor(group)};--gi:var(--gi-${group},#fff)` },
    el("span", { class: "wn" }, done ? "✓" : String(n)),
    el("span", {}, el("b", {}, name), el("span", { class: "sub" }, meta)));
}

function dayCard(day: ProgramDay) {
  return el("div", { class: "col", "data-testid": "day-card" },
    dayBar(day.items, { lit: () => false }),
    el("p", { class: "dayline" }, `Сделано 0 из ${day.items.length}`),
    el("ol", { class: "route" }, ...day.items.map((x, k) => routeRow(x.group, k + 1, x.exerciseName, `${x.sets} × ${x.reps}`, false))),
    button("wbtn", "start-workout", "Начать тренировку", start));
}

function resumeCard(w: Workout) {
  const finished = (x: WorkoutItem) => x.sets.length >= x.plan.sets;
  const meta = (x: WorkoutItem) => finished(x) ? "Сделано" : x.sets.length ? `Подходов: ${x.sets.length} из ${x.plan.sets}` : x.skipped ? "Пропущено" : `${x.plan.sets} × ${x.plan.reps}`;
  return el("div", { class: "col", "data-testid": "resume" },
    dayBar(w.items, { lit: finished }),
    el("p", { class: "dayline" }, `Сделано ${w.items.filter(finished).length} из ${w.items.length}, подходов: ${countSets(w)}`),
    el("ol", { class: "route" }, ...w.items.map((x, k) => routeRow(x.group, k + 1, x.exerciseName, meta(x), finished(x)))),
    button("wbtn", "resume-continue", "Продолжить", () => {
      unlockAudio(); // после обновления страницы звук снова нужно разрешить нажатием
      state.peek = false;
      state.signaled = !!w.rest && secondsLeft(w.rest.endsAt) <= 0; // сигнал о том, что уже прошло, только мешает
      openExercise(position(w));
      draw();
    }),
    button("wbtn ghost", "resume-finish", "Закончить", finish));
}

const errorCard = () => state.error && el("div", { class: "card bad", "data-testid": "save-error", role: "alert" }, el("p", {}, el("b", {}, state.error)));

const diaryRow = () => el("a", { class: "wrow two", href: `${base}dnevnik/`, "data-testid": "open-diary" },
  el("span", {}, el("b", {}, "Дневник"), el("span", { class: "sub", style: "margin:0" }, `Тренировок: ${state.history.filter(w => w.finishedAt).length}`)),
  el("span", { "aria-hidden": "true", class: "chev" }, "›"));

const storageError = () => !state.storageOk && el("div", { class: "card bad", "data-testid": "storage-error", role: "alert" },
  el("p", {}, el("b", {}, "Записи сейчас не сохранятся. "), "Браузер закрыл доступ к хранилищу, так бывает в приватной вкладке. Открой сайт обычной вкладкой."));

function noProgramView(): Child[] {
  return [
    el("h1", {}, "Сначала выбери программу"),
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
    [el("span", {}, el("b", {}, x.name), el("span", { class: "sub" }, x.muscles)), dayBar(x.items, { small: true })],
    () => { state.day = k; draw(); })) : [];
  return [el("div", { class: "daygrid" },
    el("div", { class: "col" },
      el("p", { class: "eyebrow" }, w?.programName ?? program!.name),
      el("h1", {}, w?.dayName ?? day!.name),
      storageError(),
      errorCard(),
      w && resumeCard(w),
      !w && day && dayCard(day)),
    el("div", { class: "col" },
      others.some(Boolean) && el("div", { class: "card" }, el("h2", {}, "Другой день"), el("div", { class: "list" }, ...others)),
      diaryRow(),
      el("p", { class: "warn", "data-testid": "care-note" }, page.care)))];
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
    el("h2", {}, w.dayName), dayBar(w.items, { lit: (_x, k) => k <= state.i }),
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
      el("div", { class: "bartop" }, dayBar(w.items, { lit: (_x, k) => k <= state.i })),
      el("div", { class: "wtop" },
        button("round", "workout-exit", backIcon(), () => { state.screen = "day"; draw(); }, { "aria-label": "Выйти из тренировки" }),
        el("span", { class: "pos", "data-testid": "exercise-pos" }, `Упражнение ${state.i + 1} из ${total}`),
        x.note && el("span", { class: "wnote" }, x.note)),
      state.peek && w.rest && el("button", { type: "button", class: "pill plain", "data-testid": "rest-pill", click: unpeek }, "Отдых ", el("span", { "data-rest": "clock" }, mmss(Math.max(secondsLeft(w.rest.endsAt), 0)))),
      el("h1", { class: "name", "data-testid": "exercise-name" }, x.exerciseName),
      errorCard(),
      el("div", { class: "tile", "data-testid": "set-tile" },
        el("div", { class: "tile-h" }, el("b", { "data-testid": "set-pos" }, setPos), el("span", {}, unit(x.plan.reps))),
        (!full || editing) && el("div", { class: "fields" }, ...(Object.keys(state.values) as SetField[]).map(f => numberField(f, state.values, "set", x.weightLabel))),
        past && el("p", { "data-testid": "last-time" }, "В прошлый раз: ", el("b", {}, setsLine(past)))),
      el("div", { class: "sets", "data-testid": "set-list" }, ...setChips(x)),
      editing && button("lnk", "edit-cancel", "Отменить исправление", () => { state.edit = null; prefill(); draw(); }),
      el("div", { class: "dock" }, el("div", {}, button("done", "set-done", label, done, { "data-lock": "", ...state.locked ? { disabled: "" } : {} }))),
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

const soundIcon = (on: boolean) => {
  const box = el("span", { class: "svgbox" });
  box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/>${on ? '<path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>' : '<path d="m16 9.5 5 5m0-5-5 5"/>'}</svg>`;
  return box;
};

/** Что дальше: следующий подход с подставленными цифрами или новое упражнение. */
function nextUp(w: Workout, from: number) {
  const x = item();
  if (state.i !== from) return [x.exerciseName, `Упражнение ${state.i + 1} из ${w.items.length}`];
  const { weight = null, reps = null, seconds = null } = state.values;
  return [`Подход ${x.sets.length + 1} из ${x.plan.sets}`, setText({ weight, reps, seconds, doneAt: "" })];
}

const RING_R = 92, RING_C = 2 * Math.PI * RING_R;
const ringOffset = (left: number, total: number) => String(RING_C * (1 - Math.min(1, Math.max(0, left / total))));
const overText = (left: number) => (left > 0 ? "отдых" : `закончился ${mmss(-left)} назад`);

function ring(group: string, left: number, total: number) {
  const box = el("div", { class: "plate" });
  box.innerHTML = `<svg viewBox="0 0 238 238" aria-hidden="true"><circle cx="119" cy="119" r="${RING_R}" fill="none" stroke="var(--surface2)" stroke-width="46"/><circle data-rest="ring" cx="119" cy="119" r="${RING_R}" fill="none" stroke="var(--g-${group},var(--muted))" stroke-width="46" stroke-dasharray="${RING_C}" stroke-dashoffset="${ringOffset(left, total)}"/></svg>`;
  box.append(el("div", {},
    el("span", { class: "clock", "data-rest": "clock", "data-testid": "rest-time" }, mmss(Math.max(left, 0))),
    el("small", { "data-rest": "label", "data-testid": "rest-label" }, overText(left))));
  return box;
}

function restView(): Child[] {
  const w = state.workout!, rest = w.rest!, left = secondsLeft(rest.endsAt), over = left <= 0;
  const finished = w.items[rest.from];
  const [title, sub] = nextUp(w, rest.from);
  const off = over ? { disabled: "" } : {};
  return [
    el("div", { class: "left", style: groupColor(finished.group) },
      errorCard(),
      el("div", { class: "rest", "data-testid": "rest" },
        el("div", { class: "reshead" },
          el("span", { class: "pos" }, finished.exerciseName),
          button("icon", "rest-sound", soundIcon(state.sound), toggleSound, { "aria-label": state.sound ? "Выключить звук" : "Включить звук" })),
        ring(finished.group, left, rest.total),
        el("div", { class: "adj" },
          button("wbtn ghost", "rest-minus", "−15", () => shiftRest(-REST_STEP), off),
          button("wbtn ghost", "rest-plus", "+15", () => shiftRest(REST_STEP), off)),
        el("div", { class: "nextc", "data-testid": "rest-next" }, el("p", { class: "eyebrow" }, "Дальше"), el("b", {}, title), el("span", {}, sub)),
        button("lnk", "rest-peek", "Исправить подход или открыть технику", peekSet),
        state.noWake && el("p", { class: "warn", "data-testid": "no-wake" }, "Экран может погаснуть по настройкам телефона. Время всё равно будет верным.")),
      el("div", { class: "dock" }, el("div", {}, button(over ? "done" : "done quiet", "rest-skip", over ? "К подходу" : "Пропустить", leaveRest,
        { "data-lock": "", ...state.locked ? { disabled: "" } : {} })))),
    planAside(w),
  ];
}

/** Обновляем только цифры: перерисовка всего экрана сбила бы ввод в полях при подглядывании. */
function tick() {
  const rest = state.screen === "work" ? state.workout?.rest : null;
  if (!rest) return;
  const left = secondsLeft(rest.endsAt);
  if (left <= 0 && !state.signaled && !document.hidden) {
    state.signaled = true;
    signal(state.sound);
    if (!state.peek) draw();
  }
  if (left > 0) state.signaled = false;
  const part = (name: string) => root.querySelector(`[data-rest="${name}"]`);
  if (part("clock")) part("clock")!.textContent = mmss(Math.max(left, 0));
  if (part("label")) part("label")!.textContent = overText(left);
  part("ring")?.setAttribute("stroke-dashoffset", ringOffset(left, rest.total));
}

function sumView(): Child[] {
  const w = state.workout!;
  const doneItems = w.items.filter(x => x.sets.length), skipped = w.items.filter(x => !x.sets.length);
  const line = (x: WorkoutItem, text: string) => el("div", { class: "ex", style: groupColor(x.group) }, el("i", { class: "dot" }), el("b", {}, x.exerciseName), el("span", {}, text));
  return [el("div", { class: "sumgrid", "data-testid": "summary" },
    el("div", { class: "wide col" },
      el("img", { class: "medal", src: `${base}img/medal.webp`, alt: "", width: "168", height: "168" }),
      el("h1", {}, "Тренировка записана"),
      el("p", { class: "sumtext" }, `${w.dayName}. Следующий раз — через день отдыха.`),
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
      el("a", { class: "wrow pic", href: `${base}dnevnik/`, "data-testid": "to-diary" },
        el("img", { src: `${base}img/notebook.webp`, alt: "", width: "72", height: "72" }),
        el("span", {}, el("b", {}, "Дневник"), el("span", { class: "sub" }, "Все тренировки и веса — в этом браузере"))),
      el("a", { class: state.reminder ? "wbtn ghost" : "wbtn", href: base, "data-testid": "to-home" }, "Готово")))];
}

function draw() {
  const work = state.screen === "work";
  document.body.classList.toggle("in-work", work);
  root.className = work ? "dv work" : "dv";
  const resting = work && !!state.workout?.rest && !state.peek;
  root.replaceChildren(...present(resting ? restView() : work ? workView() : state.screen === "sum" ? sumView() : dayView()));
  keepScreenOn(work, ok => {
    if (ok !== !state.noWake) { state.noWake = !ok; if (root.querySelector('[data-testid="rest"]')) draw(); }
  });
  if (work && state.askFinish) root.querySelector('[data-testid="finish-confirm"]')?.scrollIntoView({ block: "center" });
}

async function open() {
  state.program = page.programs.find(p => p.id === myProgram()) ?? null;
  try {
    state.history = await listWorkouts();
    state.workout = state.history.find(w => !w.finishedAt) ?? null;
    state.sound = (await getMeta()).sound;
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
/** Вернулись на страницу, а отдых истёк, пока не смотрели: время покажем, сигнал уже ни к чему. */
function catchUp() {
  const rest = state.screen === "work" ? state.workout?.rest : null;
  if (document.hidden || !rest || state.signaled || secondsLeft(rest.endsAt) > 0) return;
  state.signaled = true;
  if (!state.peek) draw();
}
document.addEventListener("visibilitychange", catchUp);
addEventListener("pageshow", catchUp);
setInterval(tick, 500);
open();
