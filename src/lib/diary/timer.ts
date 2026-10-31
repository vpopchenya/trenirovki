// Таймер отдыха. Считаем по часам, а не тиками: храним время окончания, поэтому ушёл на технику или свернул —
// при возврате время верное. Если человек выключил экран, браузер останавливает страницу: сигнала не будет, это ограничение браузера.

/** Сколько отдыхать: верхняя граница записи программы. «1,5–2 мин» → 120, «45–60 сек» → 60. Непонятная запись — null. */
export function restSeconds(rest: string) {
  const match = rest.match(/(\d+(?:,\d+)?)\s*(сек|мин)$/);
  if (!match) return null;
  return Math.round(parseFloat(match[1].replace(",", ".")) * (match[2] === "мин" ? 60 : 1));
}

export const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const secondsLeft = (endsAt: string) => Math.ceil((Date.parse(endsAt) - Date.now()) / 1000);

let audio: AudioContext | null = null;

/** Браузер разрешает звук только после нажатия, поэтому готовим его на «Готово». */
export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    audio.resume().catch(() => {});
  } catch {} // звука не будет, таймер работает и так
}

function beep(at: number) {
  const osc = audio!.createOscillator(), gain = audio!.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(.3, at);
  gain.gain.exponentialRampToValueAtTime(.001, at + .25);
  osc.connect(gain).connect(audio!.destination);
  osc.start(at);
  osc.stop(at + .25);
}

export function signal(sound: boolean) {
  navigator.vibrate?.([200, 100, 200]);
  if (sound && audio) {
    audio.resume().catch(() => {}); // после сворачивания мог уснуть
    beep(audio.currentTime);
    beep(audio.currentTime + .35);
  }
}

let lock: WakeLockSentinel | null = null;
let wanted = false;
let listening = false;
let requesting = false;
let onResult: (ok: boolean) => void = () => {};

async function requestLock() {
  if (!wanted || lock || requesting || document.hidden) return;
  requesting = true;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => { lock = null; });
    onResult(true);
    if (!wanted) lock.release().catch(() => {});
  } catch {
    onResult(false);
  }
  requesting = false;
}

/** Экран не гаснет, пока идёт тренировка. Браузер снимает блокировку при сворачивании, поэтому при возврате просим заново. */
export function keepScreenOn(on: boolean, result: (ok: boolean) => void) {
  onResult = result;
  if (wanted === on) return;
  wanted = on;
  if (!("wakeLock" in navigator)) return on ? result(false) : undefined;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", requestLock);
  }
  if (on) requestLock();
  else lock?.release().catch(() => {});
}
