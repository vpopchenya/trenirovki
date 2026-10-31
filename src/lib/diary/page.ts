// Экран дневника: список, подробности, исправление, удаление, файл.
import { clearWorkouts, deleteWorkout, getMeta, getWorkout, listWorkouts, updateSet, type Meta, type SetField, type Workout, type WorkoutItem, type WorkoutSet } from "./db";
import { filesReminder, LIMITS, loadDiaryFile, saveDiaryFile } from "./file";
import { backIcon, barbell, button, countSets, el, goal, groupColor, minutes, numberField, plural, present, setText, type Child, type SetValues } from "./ui";

const setsWord = (n: number) => `${n} ${plural(n, "подход", "подхода", "подходов")}`;
const workoutsWord = (n: number) => `${n} ${plural(n, "тренировка", "тренировки", "тренировок")}`;
const dateParts = (iso: string) => {
  const d = new Date(iso);
  const dayMonth = d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  return {
    day: String(d.getDate()),
    weekday: d.toLocaleDateString("ru-RU", { weekday: "short" }),
    dayMonth,
    month: d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""),
  };
};

const root = document.querySelector<HTMLElement>("#diary")!;
const picker = document.querySelector<HTMLInputElement>("#diary-file")!;

type Message = { kind: "okc" | "bad"; text: string } | null;
const state = {
  message: null as Message,
  askClear: false,
  askDelete: false,
  edit: null as null | { item: number; set: number; values: SetValues },
  error: "",
};

/** Ошибку базы показываем сразу: тишина здесь значит потерянные записи. */
const STORAGE_ERROR = "Записи сейчас недоступны. Браузер закрыл доступ к хранилищу, так бывает в приватной вкладке. Открой сайт обычной вкладкой.";

/** Ошибка видна до следующей перерисовки: удачный повтор не должен стоять рядом с красной карточкой. */
async function fail(err: unknown, text = "Не получилось сохранить. Попробуй ещё раз.") {
  console.warn(err);
  state.error = text;
  await draw();
  state.error = "";
}

async function saveFile() {
  try {
    const name = await saveDiaryFile();
    if (name) { state.message = { kind: "okc", text: `Файл сохранён: ${name}` }; state.askClear = false; goal("diary_export"); }
  } catch (err) { return fail(err, "Файл не сохранился. Попробуй ещё раз."); }
  await draw();
}

async function loadFile() {
  const file = picker.files?.[0];
  picker.value = ""; // тот же файл можно выбрать снова
  if (!file) return;
  try {
    const r = await loadDiaryFile(file);
    if (r.ok) goal("diary_import");
    state.message = r.ok
      ? { kind: "okc", text: `Файл загружен: добавлено ${r.added}${r.updated ? `, обновлено ${r.updated}` : ""}, уже были ${r.same}.` }
      : { kind: "bad", text: r.message };
  } catch (err) { return fail(err, "Файл не загрузился: браузер не дал записать. В дневнике ничего не изменилось."); }
  await draw();
}

const messageCard = (cls = "") => state.message && el("div", { class: `card ${state.message.kind} ${cls}`, "data-testid": "file-result", role: "status" }, el("p", {}, state.message.text));
const errorCard = () => state.error && el("div", { class: "card bad o1", "data-testid": "diary-error", role: "alert" }, el("p", {}, state.error));

function reminderCard(workouts: Workout[], meta: Meta) {
  const since = filesReminder(workouts, meta);
  if (since === null) return null;
  return el("div", { class: "card calm o1", "data-testid": "file-reminder" },
    el("p", {}, el("b", {}, "Пора сохранить файл. "), meta.lastFileAt ? `После прошлого файла ${plural(since, "прошла", "прошло", "прошло")} ${workoutsWord(since)}.` : "Записи лежат только в этом браузере."),
    button("wbtn only-m", "reminder-save", "Сохранить в файл", saveFile));
}

function fileCard(persisted: boolean) {
  return el("div", { class: "card o3", "data-testid": "file-card" },
    el("h2", {}, "Файл дневника"),
    el("p", {}, "Записи лежат только в этом браузере. Очистишь его или сменишь телефон — они пропадут. Файл — твоя копия."),
    button("wbtn", "diary-export", "Сохранить в файл", saveFile),
    button("wbtn ghost", "diary-import", "Загрузить из файла", () => picker.click()),
    el("p", { class: "warn" }, "Загрузка только добавляет записи и ничего не стирает."),
    !persisted && el("p", { class: "warn", "data-testid": "not-persisted" }, "Браузер может стереть записи, если на телефоне кончится место. Поставь приложение на экран и сохраняй файл."));
}

function clearBlock() {
  if (!state.askClear) return button("lnk end o4", "clear-diary", "Удалить весь дневник", () => { state.askClear = true; draw(); });
  return el("div", { class: "card o4", "data-testid": "clear-confirm" },
    el("p", {}, el("b", {}, "Удалить весь дневник? "), "Вернуть записи можно только из файла."),
    button("wbtn", "clear-save-first", "Сначала сохранить файл", saveFile),
    button("wbtn danger", "clear-confirm-yes", "Удалить всё", async () => {
      try { await clearWorkouts(); } catch (err) { return fail(err, "Не получилось удалить. Попробуй ещё раз."); }
      state.askClear = false; state.message = null; draw();
    }),
    button("lnk", "clear-cancel", "Оставить", () => { state.askClear = false; draw(); }));
}

function workoutRow(w: Workout) {
  const { day, weekday } = dateParts(w.startedAt);
  const details = [setsWord(countSets(w)), minutes(w) ? `${minutes(w)} мин` : "не закончена", w.items.some(x => x.skipped) && "есть пропуск"].filter(Boolean).join(" · ");
  return button("wrow", "workout-row", [
    el("span", { class: "wdate" }, day, el("small", {}, weekday)),
    el("span", {}, el("b", {}, w.dayName), el("span", { class: "sub" }, details), barbell(w.items, { small: true })),
  ], () => { location.hash = encodeURIComponent(w.id); });
}

function workoutList(workouts: Workout[]) {
  const rows: Node[] = [];
  let month = "";
  for (const w of workouts) {
    const m = dateParts(w.startedAt).month;
    if (m !== month) { rows.push(el("p", { class: "eyebrow" }, m)); month = m; }
    rows.push(workoutRow(w));
  }
  return el("div", { class: "list o2", "data-testid": "workout-list" }, ...rows);
}

function emptyView() {
  return [
    el("h1", { "data-testid": "diary-title" }, el("em", { class: "wave" }, "Дневник")),
    el("p", { "data-testid": "diary-empty" }, "Записей пока нет. Первая появится после тренировки."),
    errorCard(),
    messageCard(),
    button("wbtn ghost", "diary-import", "Загрузить из файла", () => picker.click()),
    el("p", { class: "warn" }, "Сохранял дневник раньше? Загрузи файл, и записи вернутся."),
  ];
}

async function listView() {
  const [workouts, meta, persisted] = await Promise.all([listWorkouts(), getMeta(), navigator.storage?.persisted?.() ?? true]);
  if (!workouts.length) return emptyView();
  return [
    el("h1", { "data-testid": "diary-title" }, el("em", { class: "wave" }, "Дневник")),
    el("div", { class: "diarygrid" },
      el("div", { class: "side" }, errorCard(), messageCard("o1"), reminderCard(workouts, meta), fileCard(persisted), clearBlock()),
      workoutList(workouts)),
  ];
}

function editForm(w: Workout, item: WorkoutItem, i: number, k: number) {
  const fields = (Object.keys(LIMITS) as SetField[]).filter(f => state.edit!.values[f] !== undefined);
  return el("div", { class: "edit", "data-testid": "set-edit" },
    el("div", { class: "fields" }, ...fields.map(f => numberField(f, state.edit!.values, "edit", item.weightLabel))),
    el("div", { class: "row2" },
      button("wbtn", "edit-save", "Сохранить", async () => {
        try { await updateSet(w.id, i, k, state.edit!.values); } catch (err) { return fail(err); }
        state.edit = null; draw();
      }),
      button("wbtn ghost", "edit-cancel", "Отмена", () => { state.edit = null; draw(); })));
}

function exerciseCard(w: Workout, item: WorkoutItem, i: number) {
  const startEdit = (k: number, s: WorkoutSet) => () => {
    const values: SetValues = {};
    for (const f of Object.keys(LIMITS) as SetField[]) if (s[f] !== null) values[f] = s[f]!;
    state.edit = { item: i, set: k, values };
    draw();
  };
  const row = (s: WorkoutSet, k: number) => state.edit?.item === i && state.edit.set === k
    ? editForm(w, item, i, k)
    : button("setrow", "set-row", [el("span", {}, `${k + 1}: ${setText(s)}`), el("em", {}, "исправить")], startEdit(k, s), { "aria-label": `Исправить подход ${k + 1}` });
  return el("div", { class: "card", style: groupColor(item.group), "data-testid": "workout-exercise" },
    el("div", { class: "exh" }, el("i", { class: "dot" }), el("b", {}, item.exerciseName)),
    !item.sets.length && el("p", { class: "warn" }, "Пропущено"),
    item.sets.length > 0 && el("div", {}, ...item.sets.map(row)));
}

function deleteBlock(w: Workout) {
  if (!state.askDelete) return button("lnk end", "delete-workout", "Удалить тренировку", () => { state.askDelete = true; draw(); });
  return el("div", { class: "card", "data-testid": "delete-ask" },
    el("p", {}, el("b", {}, "Удалить тренировку? "), "Если потом загрузить старый файл, она вернётся: файл только добавляет записи."),
    el("div", { class: "row2" },
      button("wbtn danger", "delete-confirm", "Удалить", async () => {
        try { await deleteWorkout(w.id); } catch (err) { return fail(err, "Не получилось удалить. Попробуй ещё раз."); }
        location.hash = "";
      }),
      button("wbtn ghost", "delete-cancel", "Оставить", () => { state.askDelete = false; draw(); })));
}

async function detailView(id: string) {
  const w = await getWorkout(id);
  if (!w) { location.hash = ""; return []; } // удалена или чужая ссылка
  const { dayMonth } = dateParts(w.startedAt);
  const sets = countSets(w);
  const done = w.items.filter(x => x.sets.length).length;
  return [
    button("pill", "diary-back", [backIcon(), "Дневник"], () => { location.hash = ""; }),
    el("h1", {}, `${w.dayName}, `, el("em", { class: "wave" }, dayMonth)),
    el("p", {}, w.programName),
    errorCard(),
    el("div", { class: "stats" },
      el("div", {}, el("b", {}, String(sets)), plural(sets, "подход", "подхода", "подходов")),
      el("div", {}, el("b", {}, String(done)), plural(done, "упражнение", "упражнения", "упражнений")),
      el("div", {}, el("b", {}, minutes(w) ? `${minutes(w)} мин` : "—"), "времени")),
    ...w.items.map((x, i) => exerciseCard(w, x, i)),
    deleteBlock(w),
  ];
}

/** Адрес можно набрать руками: непонятный хэш значит то же, что «нет такой записи». */
function openId() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return ""; }
}

async function draw() {
  const id = openId();
  document.body.classList.toggle("in-detail", !!id);
  let view: Child[];
  try {
    view = id ? await detailView(id) : await listView();
  } catch (err) {
    console.warn(err);
    view = [el("h1", { "data-testid": "diary-title" }, el("em", { class: "wave" }, "Дневник")),
      el("div", { class: "card bad", "data-testid": "storage-error", role: "alert" }, el("p", {}, el("b", {}, STORAGE_ERROR)))];
  }
  root.className = id ? "dv narrow" : "dv";
  root.replaceChildren(...present(view));
}

// Адрес #id: кнопка «назад» на телефоне возвращает из подробностей в список, обновление страницы их не закрывает.
addEventListener("hashchange", () => {
  Object.assign(state, { edit: null, askDelete: false, askClear: false, message: null, error: "" });
  draw();
  scrollTo(0, 0);
});
picker.addEventListener("change", loadFile);
draw();
