import { TideGame, RULES, MODES, GIFTS, minimumViewWidth, waterY, sceneryState } from "./engine.js";
import { TideSound } from "./sound.js";
import { ProgressStore, SKINS, MISSIONS, MASTERY, utcDate, dailyRandom, dailyMissions, bestComparison } from "./progress.js";
import { DAILY_RULES, dailyResultText, shareDaily, copyDaily } from "./sharing.js";

const $ = id => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const game = new TideGame();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let state = "ready";
let updateReady = false;
const startedControlled = Boolean(navigator.serviceWorker?.controller);
function applyUpdateWhenSafe() {
  if (!updateReady || ["running", "paused", "crashing"].includes(state)) return;
  try {
    if (sessionStorage.getItem("tiny-tide-reloaded-build") === "T11") return;
    sessionStorage.setItem("tiny-tide-reloaded-build", "T11");
  } catch (error) {
    console.warn("Tiny Tide could not guard an automatic update reload:", error);
    $("update-game").hidden = false;
    return;
  }
  location.reload();
}
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (!startedControlled) return;
  updateReady = true;
  $("update-game").hidden = false;
  applyUpdateWhenSafe();
});
$("update-game").addEventListener("click", () => location.reload());
let width = 900;
let lastTime = 0;
let visualTime = 0;
let best = 0;
let runDate = null;
let runCourse = "endless";
let goalDate = utcDate();
let runId = null;
let runBest = 0;
let lastResult = null;
let shownGoalDate = null;
const bests = { easy: 0, medium: 0, fast: 0 };
const previousBests = { easy: 0, medium: 0, fast: 0 };
let muted = false;
let sparkles = [];
let feedbackTime = 0;
let wasHolding = false;
let wasBoosting = false;
let crashTime = 0;
let crashDuration = 0;
let crashOrigin = null;
let lastTideSound = -Infinity;
let storageAvailable = true;
const tidePointers = new Set();
const boostPointers = new Set();
const tideKeys = new Set();
const boostKeys = new Set();
const holding = () => tidePointers.size > 0 || tideKeys.size > 0;
const boosting = () => boostPointers.size > 0 || boostKeys.size > 0;
const bestKey = mode => `tiny-tide-best-${DAILY_RULES}-${mode}`;

try {
  for (const mode of Object.keys(MODES)) {
    const stored = localStorage.getItem(bestKey(mode));
    const value = Number(stored);
    bests[mode] = stored !== null && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const old = Number(localStorage.getItem(`tiny-tide-best-tide-boost-3-${mode}`) || localStorage.getItem(`tiny-tide-best-tide-boost-2-${mode}`) || localStorage.getItem(`tiny-tide-best-${mode}`) || (mode === "medium" ? localStorage.getItem("tiny-tide-best") : 0));
    previousBests[mode] = Number.isSafeInteger(old) && old > 0 ? old : 0;
  }
  best = bests.medium;
  muted = localStorage.getItem("tiny-tide-muted") === "true";
} catch (error) {
  storageAvailable = false;
  $("notice").textContent = "Private storage is unavailable. Scores, coins and settings last for this visit.";
  console.warn("Tiny Tide could not read local storage:", error);
}
$("best").textContent = `${best} pts`;
const progress = new ProgressStore({
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
}, error => {
  $("notice").textContent = "Progress storage unavailable. New rewards last this visit; boat purchases are disabled.";
  console.warn("Tiny Tide progress storage failed:", error);
});
const coinBank = () => progress.data.coins;
const sound = new TideSound({ muted, onError: error => {
  $("sound").disabled = true;
  $("sound").textContent = "No audio";
  $("sound").setAttribute("aria-label", "Audio unavailable");
  $("notice").textContent = "Sound is unavailable in this browser. You can still play.";
  console.warn("Tiny Tide could not enable audio:", error);
} });

function save(key, value) {
  if (!storageAvailable) return;
  try { localStorage.setItem(key, String(value)); }
  catch (error) {
    storageAvailable = false;
    $("notice").textContent = "Couldn't save progress. Scores, coins and settings last for this visit.";
    console.warn("Tiny Tide could not save local storage:", error);
  }
}

function updateSoundButton() {
  $("sound").textContent = muted ? "Sound off" : "Sound on";
  $("sound").setAttribute("aria-pressed", String(muted));
  $("sound").setAttribute("aria-label", muted ? "Enable sound" : "Mute sound");
}
updateSoundButton();
function updateBestPreview() {
  const daily = $("course").value === "daily";
  best = daily ? progress.data.dailyBests[utcDate()] || 0 : bests[$("mode").value];
  $("best").textContent = `${best} pts`;
  const legacyDaily = progress.data.archivedT10DailyBests[utcDate()] || progress.data.archivedBoostDailyBests[utcDate()] || progress.data.legacyDailyBests[utcDate()];
  const previous = daily ? legacyDaily : previousBests[$("mode").value];
  $("previous-best").hidden = !previous;
  $("previous-best").textContent = previous ? `Previous rules: ${previous} pts · archived, not compared` : "";
  $("daily-date").hidden = !daily;
  $("daily-date").textContent = `${utcDate()} UTC · fixed Medium · ${DAILY_RULES}`;
  $("mode").disabled = daily;
}
$("course").addEventListener("change", () => {
  if (state !== "ready" && state !== "over") { $("course").value = runCourse; return; }
  updateBestPreview();
});
$("mode").addEventListener("change", () => {
  if (state !== "ready" && state !== "over") {
    $("mode").value = game.mode;
    return;
  }
  updateBestPreview();
});
const skinButtons = new Map();
for (const [id, skin] of Object.entries(SKINS)) {
  const card = document.createElement("div");
  card.className = "skin-card";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("skin-preview");
  svg.setAttribute("viewBox", "-32 -42 64 58");
  svg.setAttribute("aria-label", `${skin.name} preview`);
  svg.setAttribute("role", "img");
  for (const [points, fill] of [["-26,-3 26,-3 14,9 -15,9", skin.hull], ["-22,-4 -2,-39 -2,-4", skin.sail], ["0,-37 21,-5 0,-5", skin.fold]]) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    shape.setAttribute("points", points);
    shape.setAttribute("fill", fill);
    svg.append(shape);
  }
  const title = document.createElement("div");
  title.textContent = skin.name;
  const button = document.createElement("button");
  button.dataset.skin = id;
  button.addEventListener("click", () => {
    if (state !== "ready" && state !== "over") return;
    try {
      progress.chooseSkin(id);
      $("shop-feedback").textContent = `${skin.name} selected.`;
      renderProgress();
      draw();
    } catch (error) {
      $("shop-feedback").textContent = error.message;
      console.warn("Tiny Tide boat selection failed:", error);
      renderProgress();
    }
  });
  card.append(svg, title, button);
  $("skins").append(card);
  skinButtons.set(id, button);
}
function renderProgress() {
  $("coin-bank").textContent = String(coinBank());
  for (const [id, button] of skinButtons) {
    const owned = progress.data.owned.includes(id);
    const badge = MASTERY.find(item => item.id === SKINS[id].mastery);
    button.textContent = progress.data.selected === id ? "Selected" : owned ? "Select" : badge ? `Earn: ${badge.target} ${badge.detail}` : `Unlock · ${SKINS[id].price} coins`;
    button.setAttribute("aria-label", `${SKINS[id].name}: ${button.textContent}`);
    button.disabled = !progress.persistent || (state !== "ready" && state !== "over") || progress.data.selected === id || (!owned && (Boolean(badge) || coinBank() < SKINS[id].price));
  }
  $("missions").replaceChildren(...MISSIONS.map(mission => {
    const item = document.createElement("li");
    const completed = progress.data.completed.includes(mission.id);
    item.textContent = `${mission.label}: ${completed ? "Complete" : `${Math.min(mission.target, game[mission.metric])}/${mission.target}`} · ${mission.reward} coins${completed ? " paid" : " reward"}`;
    return item;
  }));
  const date = state === "running" || state === "paused" ? goalDate : utcDate();
  shownGoalDate = date;
  const daily = progress.data.dailyGoals[date];
  const dailyGoals = dailyMissions(date);
  $("daily-missions-date").textContent = `${date} UTC${state === "running" || state === "paused" ? " · frozen for this run" : ""}`;
  $("daily-missions").replaceChildren(...dailyGoals.map(mission => {
    const item = document.createElement("li");
    const claimed = daily?.claimed.includes(mission.id);
    item.textContent = `${mission.label}: ${claimed ? "Complete" : `${daily?.[mission.metric] || 0}/${mission.target}`} · ${mission.reward} coins${claimed ? " paid" : " reward"}`;
    return item;
  }));
  $("mastery").replaceChildren(...MASTERY.map(badge => {
    const item = document.createElement("li");
    const total = progress.data.totals[badge.metric];
    item.textContent = `${badge.label}: ${Math.min(total, badge.target)}/${badge.target} ${badge.detail}${total >= badge.target ? " · badge earned" : ""}${badge.skin ? ` · ${SKINS[badge.skin].name} ${total >= badge.target ? "unlocked" : "unlock"}` : ""}`;
    return item;
  }));
  const next = dailyGoals.find(mission => !daily?.claimed.includes(mission.id));
  const badge = MASTERY.find(item => progress.data.totals[item.metric] < item.target);
  $("mission-summary").textContent = next ? `Today's ${next.label.toLowerCase()} · ${daily?.[next.metric] || 0}/${next.target}`
    : badge ? `Next: ${badge.label} · ${progress.data.totals[badge.metric]}/${badge.target}` : "Today's goals and mastery complete. Float for fun!";
  $("mastery-next").textContent = badge ? `Next badge: ${badge.label} · ${progress.data.totals[badge.metric]}/${badge.target} ${badge.detail}` : "All three badges earned. Your boats stay yours.";
}
$("studio").addEventListener("toggle", () => { if ($("studio").open) pause(); });
renderProgress();
updateBestPreview();
$("sound").addEventListener("click", async () => {
  muted = !muted;
  sound.setMuted(muted);
  save("tiny-tide-muted", muted);
  updateSoundButton();
  if (!muted) {
    await sound.unlock();
    if (!document.hidden) sound.play("coin");
  }
});

async function playFromGesture(name) {
  await sound.unlock();
  if (state === "running" && !document.hidden) sound.play(name);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  width = Math.max(minimumViewWidth(game.mode), Math.min(1100, rect.width / rect.height * RULES.height));
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / RULES.height, 0, 0);
  draw();
}
new ResizeObserver(resize).observe(canvas);

function clearInput() {
  game.boostAmount = 0;
  tidePointers.clear();
  boostPointers.clear();
  tideKeys.clear();
  boostKeys.clear();
  $("tide").classList.remove("active");
  $("boost").classList.remove("active");
  $("boost").setAttribute("aria-pressed", "false");
}

function start() {
  sound.stop();
  crashTime = 0;
  crashOrigin = null;
  $("impact").hidden = true;
  goalDate = utcDate();
  runId = progress.beginRun(goalDate);
  runCourse = $("course").value;
  runDate = runCourse === "daily" ? goalDate : null;
  game.random = runDate ? dailyRandom(runDate) : Math.random;
  game.reset(runDate ? "medium" : $("mode").value);
  best = runDate ? progress.data.dailyBests[runDate] || 0 : bests[game.mode];
  runBest = best;
  lastResult = null;
  $("run-result").hidden = true;
  $("share-panel").hidden = true;
  $("share-status").textContent = "";
  $("share-text").value = "";
  $("best").textContent = `${best} pts`;
  $("mode").disabled = true;
  $("course").disabled = true;
  $("daily-date").textContent = runDate ? `${runDate} UTC · fixed Medium · ${DAILY_RULES}` : "";
  resize();
  sparkles = [];
  feedbackTime = 0;
  wasHolding = false;
  wasBoosting = false;
  lastTideSound = -Infinity;
  $("run-coins").textContent = "0";
  $("flow").textContent = "Flow 0% · 1.00×";
  $("combo").textContent = "Perfect pass: exit in the gold band.";
  $("mission-feedback").textContent = "";
  $("studio").open = false;
  $("coin-feedback").textContent = "Follow the gold. Find your flow.";
  clearInput();
  state = "running";
  renderProgress();
  $("overlay").hidden = true;
  $("pause").disabled = false;
  $("pause").textContent = "Ⅱ";
  $("pause").setAttribute("aria-label", "Pause game");
  $("tide").disabled = false;
  $("boost").disabled = false;
  $("announcement").textContent = "Let's float. Hold to rise over the first rock.";
  lastTime = performance.now();
  canvas.focus({ preventScroll: true });
  playFromGesture("start");
}

function showOverlay(kicker, title, copy, button, hint) {
  $("overlay-kicker").textContent = kicker;
  $("overlay-title").textContent = title;
  $("overlay-copy").textContent = copy;
  $("play").textContent = button;
  $("overlay-hint").textContent = hint;
  $("overlay").hidden = false;
}

function pause() {
  if (state !== "running") return;
  state = "paused";
  clearInput();
  sound.stop();
  $("tide").disabled = true;
  $("boost").disabled = true;
  $("pause").textContent = "▶";
  $("pause").setAttribute("aria-label", "Resume game");
  showOverlay("TAKE A BREATHER", "A moment of calm.", "Your little boat will wait right here.", "Keep floating →", "Press P or Space to resume.");
  $("announcement").textContent = "Game paused.";
}

function resume() {
  if (document.hidden) return;
  clearInput();
  state = "running";
  lastTime = performance.now();
  $("overlay").hidden = true;
  $("tide").disabled = false;
  $("boost").disabled = false;
  $("pause").textContent = "Ⅱ";
  $("pause").setAttribute("aria-label", "Pause game");
  canvas.focus({ preventScroll: true });
  playFromGesture("start");
}

function finish() {
  if (state !== "crashing") return;
  state = "over";
  clearInput();
  $("impact").hidden = true;
  sound.stop();
  if (!document.hidden) sound.play("finish");
  $("pause").disabled = true;
  $("mode").disabled = runCourse === "daily";
  $("course").disabled = false;
  $("tide").disabled = true;
  $("boost").disabled = true;
  const record = game.score > runBest;
  if (record) {
    best = game.score;
    $("best").textContent = `${best} pts`;
    if (runDate) progress.recordDaily(runDate, best);
    else {
      bests[game.mode] = best;
      save(bestKey(game.mode), best);
      bests[game.mode] = best;
    }
  }
  const reason = game.failure === "rock" ? "A little too low. Hold earlier to clear the rocks." : "A little too high. Release earlier for the bridge.";
  showOverlay(record && runBest > 0 ? `A NEW ${runDate ? "DAILY" : MODES[game.mode].label.toUpperCase()} BEST` : "EVERY TIDE TEACHES YOU", `${game.score} flow points.`, reason, "Float again →", `${Math.floor(game.distance / 10)} m · ${game.bonus} bonus points · ${game.collected} coins · Space to retry`);
  lastResult = Object.freeze({ date: runDate, score: game.score, distance: Math.floor(game.distance / 10), bonus: game.bonus, coins: game.collected, giftCoins: game.giftCoins, passed: game.passed, perfects: game.perfects });
  $("result-comparison").textContent = `${runDate ? `${runDate} UTC Daily · ${DAILY_RULES}` : `${MODES[game.mode].label} Endless`}: ${bestComparison(game.score, runBest)}`;
  $("result-goal").textContent = nextGoalText(goalDate);
  $("run-result").hidden = false;
  $("share-options").hidden = !runDate;
  $("announcement").textContent = `${game.score} points. ${reason} ${$("result-comparison").textContent} ${$("result-goal").textContent}`;
  renderProgress();
  updateBestPreview();
}

function beginCrash() {
  if (!game.failure || !["running", "paused"].includes(state)) return;
  state = "crashing";
  clearInput();
  crashTime = 0;
  crashDuration = reducedMotion ? .35 : 1.4;
  crashOrigin = { y: waterY(game.lift) };
  $("impact").hidden = false;
  $("tide").disabled = true;
  $("boost").disabled = true;
  $("pause").disabled = true;
  $("announcement").textContent = "Splash! Your boat broke apart. Showing your score in a moment.";
  sound.stop();
  sound.play("crash");
}

function nextGoalText(date) {
  const daily = progress.data.dailyGoals[date];
  const next = dailyMissions(date).find(mission => !daily?.claimed.includes(mission.id));
  if (next) return `${date} UTC goal: ${next.label} · ${daily?.[next.metric] || 0}/${next.target} toward ${next.reward} coins. Counts across runs.`;
  const badge = MASTERY.find(item => progress.data.totals[item.metric] < item.target);
  return badge ? `Next mastery: ${badge.label} · ${progress.data.totals[badge.metric]}/${badge.target} ${badge.detail}.`
    : "Daily goals and all mastery complete. Your earned boats are permanent.";
}

for (const [id, action] of [["share-result", shareDaily], ["copy-result", copyDaily]]) {
  $(id).addEventListener("click", async () => {
    if (!lastResult?.date) return;
    const result = lastResult;
    const text = dailyResultText(result);
    $("share-text").value = text;
    $("share-panel").hidden = false;
    $("share-result").disabled = true;
    $("copy-result").disabled = true;
    const response = await action(text);
    $("share-result").disabled = false;
    $("copy-result").disabled = false;
    if (response.error) console.warn("Tiny Tide Daily result action failed:", response.error);
    if (lastResult === result) $("share-status").textContent = response.message;
  });
}
$("share-text").addEventListener("focus", () => $("share-text").select());

$("play").addEventListener("click", () => state === "paused" ? resume() : state === "crashing" ? undefined : start());
$("pause").addEventListener("click", () => state === "paused" ? resume() : pause());
for (const element of [canvas, $("tide"), $("boost")]) {
  const boostControl = element === $("boost");
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0 || state !== "running") return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    (boostControl ? boostPointers : tidePointers).add(event.pointerId);
    sound.unlock();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    element.addEventListener(name, event => {
      tidePointers.delete(event.pointerId);
      boostPointers.delete(event.pointerId);
    });
  }
  element.addEventListener("contextmenu", event => event.preventDefault());
}
window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLSelectElement || (event.target instanceof Element && event.target.closest("#studio, #run-result"))) return;
  if (event.code === "KeyP" || event.code === "Escape") {
    if (event.repeat) return;
    event.preventDefault();
    if (state === "running") pause();
    else if (state === "paused") resume();
    return;
  }
  if (event.code === "ArrowRight" || (event.code === "Space" && event.target === $("boost"))) {
    if (event.repeat) return;
    event.preventDefault();
    if (state === "running") boostKeys.add(event.code);
    return;
  }
  if (!["Space", "ArrowUp"].includes(event.code)) return;
  if (event.code === "Space" && event.target instanceof HTMLButtonElement && event.target !== $("tide")) return;
  event.preventDefault();
  if (event.repeat) return;
  if (state === "crashing") return;
  if (state === "paused") resume();
  else if (state !== "running") start();
  tideKeys.add(event.code);
});
window.addEventListener("keyup", event => {
  tideKeys.delete(event.code);
  boostKeys.delete(event.code);
});
function leaveGame() {
  if (state === "crashing") finish();
  else pause();
  clearInput();
  sound.stop();
}
window.addEventListener("blur", leaveGame);
document.addEventListener("visibilitychange", () => { if (document.hidden) leaveGame(); });

function path(points, fill, stroke) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function rounded(x, y, w, h, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

const SCENES = [
  { name: "Garden canal", sky: "#e5edde", cloud: "#dae5d3", tree: "#b8ceaf", bank: "#bfceae", water: "#67b5ab", deep: "#327f7c", stone: "#778b72", stoneLight: "#a6ae86", stoneDark: "#4c6557", moss: "#70996a", bridge: "#9b7958", bridgeLight: "#d0ad78", bridgeDark: "#614b3c" },
  { name: "Rainy streets", sky: "#c5d3d9", cloud: "#adbfc9", tree: "#879d9c", bank: "#a9b3a5", water: "#65a5b2", deep: "#356878", stone: "#748d91", stoneLight: "#a0b0aa", stoneDark: "#435f6a", moss: "#718f7e", bridge: "#7d8584", bridgeLight: "#c2b893", bridgeDark: "#4c5d64" },
  { name: "Moonlit water", sky: "#334958", cloud: "#425d6a", tree: "#607c79", bank: "#7c9385", water: "#619cac", deep: "#34566c", stone: "#586f74", stoneLight: "#879994", stoneDark: "#344e5b", moss: "#718c7a", bridge: "#676f73", bridgeLight: "#a4a287", bridgeDark: "#394d59" },
];
function mixColor(a, b, t) {
  const channels = [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - t) + parseInt(b.slice(offset, offset + 2), 16) * t));
  return `rgb(${channels.join(",")})`;
}

function drawRock(obstacle, x, palette) {
  const edge = obstacle.edge;
  const w = obstacle.width;
  path([[x - 6, 552], [x + 1, edge + 33], [x + 10, edge + 21], [x + 22, edge], [x + 38, edge + 8], [x + 49, edge + 2], [x + w - 5, edge + 27], [x + w + 9, 552]], palette("stoneDark"), "#40574e");
  path([[x + 3, 550], [x + 6, edge + 34], [x + 22, edge], [x + 38, edge + 8], [x + 48, edge + 3], [x + 54, edge + 25], [x + 35, edge + 39], [x + 20, edge + 30]], palette("stoneLight"));
  path([[x + 38, edge + 9], [x + 49, edge + 3], [x + w - 5, edge + 27], [x + w + 5, 550], [x + 37, 550], [x + 29, edge + 39]], palette("stone"));
  path([[x + 11, edge + 21], [x + 22, edge + 5], [x + 26, edge + 26], [x + 17, edge + 32]], palette("stone"));
  ctx.strokeStyle = "#344d4399";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const tx = x + 17 + i * Math.max(12, (w - 36) / 3);
    ctx.beginPath();
    ctx.moveTo(tx, edge + 28 + (i % 2) * 12);
    ctx.lineTo(tx + 8, edge + 36 + (i % 2) * 12);
    ctx.lineTo(tx + 5, edge + 44 + (i % 2) * 12);
    ctx.stroke();
  }
  path([[x + 20, edge + 13], [x + 27, edge + 8], [x + 36, edge + 12], [x + 31, edge + 17]], palette("moss"));
}

function drawBridge(obstacle, x, palette) {
  const edge = obstacle.edge;
  const w = obstacle.width;
  rounded(x - 7, 188, w + 14, Math.max(25, edge - 188), 7, palette("bridgeDark"));
  rounded(x - 2, 194, w + 4, Math.max(22, edge - 194), 5, palette("bridge"));
  rounded(x + 2, 198, w - 4, 8, 3, palette("bridgeLight"));
  rounded(x - 5, edge - 23, w + 10, 23, 5, palette("bridgeDark"));
  rounded(x, edge - 20, w, 14, 3, palette("bridgeLight"));
  rounded(x, edge - 6, w, 6, 2, palette("bridge"));
  ctx.strokeStyle = `${palette("bridgeDark")}aa`;
  ctx.lineWidth = 1.5;
  for (let y = 222; y < edge - 24; y += 22) {
    ctx.beginPath();
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + w - 3, y);
    ctx.stroke();
    const offset = y % 44 < 22 ? w * .34 : w * .68;
    ctx.beginPath();
    ctx.moveTo(x + offset, y);
    ctx.lineTo(x + offset, Math.min(edge - 24, y + 22));
    ctx.stroke();
  }
  for (const boltX of [x + 12, x + w - 12]) {
    ctx.fillStyle = palette("bridgeDark");
    ctx.beginPath();
    ctx.arc(boltX, edge - 13, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  rounded(x + 8, 210, Math.max(8, w * .12), Math.max(0, edge - 241), 4, palette("bridgeLight"));
  rounded(x + w * .84, 210, Math.max(8, w * .12), Math.max(0, edge - 241), 4, palette("bridgeLight"));
  path([[x + 7, 215], [x + 16, 215], [x + 22, 221], [x + 13, 224]], palette("moss"));
}

function drawBoat(skin) {
  const y = waterY(game.lift);
  ctx.save();
  ctx.translate(RULES.boatX, y);
  ctx.fillStyle = "#27696235";
  ctx.beginPath(); ctx.ellipse(0, 18, 38, 6, 0, 0, Math.PI * 2); ctx.fill();
  path([[-26, -3], [26, -3], [14, 9], [-15, 9]], "#f5ecd4", "#e0d4b8");
  path([[-22, -4], [-2, -39], [-2, -4]], skin.sail);
  path([[0, -37], [21, -5], [0, -5]], skin.fold);
  path([[-26, -3], [0, 3], [26, -3], [14, 9], [-15, 9]], skin.hull);
  ctx.restore();
}

function drawCrash(skin) {
  if (!crashOrigin) return;
  const progress = Math.min(1, crashTime / crashDuration);
  const ease = 1 - (1 - progress) ** 3;
  const lowMotion = reducedMotion;
  ctx.save();
  ctx.translate(RULES.boatX, crashOrigin.y - 5);
  if (!lowMotion) {
    ctx.globalAlpha = .85 * Math.max(0, 1 - progress / .5);
    const radius = 26 + 65 * ease;
    const points = Array.from({ length: 16 }, (_, i) => {
      const angle = i * Math.PI / 8;
      const r = i % 2 ? radius * .5 : radius;
      return [Math.cos(angle) * r, Math.sin(angle) * r - 14];
    });
    path(points, "#ffcf54", "#b85f27");
  }
  ctx.globalAlpha = Math.max(.65, 1 - progress * .35);
  ctx.fillStyle = "#b9eee1";
  ctx.strokeStyle = "#275d67";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-42, 17);
  ctx.quadraticCurveTo(-24, -32 * ease, -12, 0);
  ctx.quadraticCurveTo(0, -55 * ease, 12, 0);
  ctx.quadraticCurveTo(28, -32 * ease, 42, 17);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#f4fff0";
  ctx.lineWidth = lowMotion ? 3 : 4;
  ctx.beginPath();
  ctx.ellipse(0, 16, 10 + 48 * ease, 3 + 13 * ease, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI + i * Math.PI / 4;
    const travel = (lowMotion ? 32 : 90) * ease;
    const x = Math.cos(angle) * travel;
    const y = Math.sin(angle) * travel - (lowMotion ? 0 : Math.sin(progress * Math.PI) * 24) + ease * (lowMotion ? 4 : 12);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.5, 1.5);
    ctx.rotate(angle + progress * (lowMotion ? .2 : 2.8));
    ctx.lineWidth = 1.5;
    if (i % 3 === 0) {
      path([[-5, 5], [-2, -15], [2, 4]], skin.sail, "#4b5c53");
    } else if (i % 3 === 1) {
      path([[-11, -3], [10, -3], [3, 5], [-7, 5]], skin.hull, "#4b382d");
    } else {
      path([[-6, -5], [6, -3], [4, 5], [-5, 4]], skin.fold, "#5e5546");
    }
    ctx.restore();
  }
  for (let i = 0; i < 7; i++) {
    const angle = -Math.PI + i * Math.PI / 6;
    const radius = 18 + ease * 48;
    ctx.fillStyle = i % 2 ? "#f4fff0" : "#b9eee1";
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * radius, 14 + Math.sin(angle) * (lowMotion ? 10 : 24), lowMotion ? 3 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, width, RULES.height);
  const scene = sceneryState(game.elapsed);
  const palette = key => mixColor(SCENES[scene.from][key], SCENES[scene.to][key], scene.blend);
  $("scenery").textContent = SCENES[scene.blend < .5 ? scene.from : scene.to].name;
  ctx.fillStyle = palette("sky");
  ctx.fillRect(0, 0, width, RULES.height);
  const scroll = game.distance;
  if (scene.from >= 1) {
    ctx.globalAlpha = scene.from === 2 ? 1 : scene.blend;
    ctx.fillStyle = "#fff3c9";
    ctx.beginPath(); ctx.arc(width - 80, 65, 20, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  for (let i = -1; i < width / 180 + 2; i++) {
    const x = i * 180 - (scroll * .22 % 180);
    rounded(x, 125 + Math.sin(i * 3) * 15, 125, 50, 25, palette("cloud"));
    rounded(x + 40, 100 + Math.sin(i * 3) * 15, 70, 60, 30, palette("cloud"));
    ctx.fillStyle = "#bfd2bb";
    ctx.fillRect(x + 60, 190, 3, 25);
    path([[x + 61, 150], [x + 37, 197], [x + 85, 197]], palette("tree"));
    path([[x + 111, 170], [x + 92, 207], [x + 130, 207]], palette("tree"));
    if (scene.from === 1 || scene.to === 1) {
      ctx.globalAlpha = scene.from === 0 ? scene.blend : 1 - scene.blend;
      rounded(x + 25, 148, 55, 62, 3, "#8d9f9e");
      rounded(x + 39, 160, 10, 15, 1, "#f5e6b7");
      ctx.strokeStyle = "#eef9ff88"; ctx.lineWidth = 1;
      for (let drop = 0; drop < 5; drop++) {
        const dx = x + drop * 32;
        const dy = reducedMotion ? 50 + drop * 20 : (visualTime * 90 + drop * 37) % 205;
        ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx - 5, dy + 12); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = "#d0ddc4";
  ctx.fillRect(0, 218, width, 382);
  ctx.fillStyle = palette("bank");
  ctx.fillRect(0, 235, width, 365);
  for (let i = 0; i < width / 70 + 1; i++) {
    rounded(i * 70 - (scroll * .5 % 70), 247, 56, 9, 4, "#b0c39f");
  }
  ctx.fillStyle = "#718f79";
  ctx.fillRect(0, 545, width, 55);
  ctx.fillStyle = "#607f6c";
  ctx.fillRect(0, 555, width, 45);
  const y = waterY(game.lift);
  for (const obstacle of game.obstacles) {
    const x = obstacle.x - scroll;
    if (x > width + 120 || x < -150) continue;
    if (obstacle.type === "rock") {
      drawRock(obstacle, x, palette);
    } else {
      drawBridge(obstacle, x, palette);
    }
  }
  const water = ctx.createLinearGradient(0, y, 0, 600);
  water.addColorStop(0, palette("water"));
  water.addColorStop(1, palette("deep"));
  ctx.globalAlpha = .9;
  ctx.fillStyle = water;
  ctx.fillRect(0, y, width, RULES.height - y);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += 8) {
    const wy = y + (reducedMotion ? 0 : Math.sin(x / 42 + visualTime * 2) * 2);
    x ? ctx.lineTo(x, wy) : ctx.moveTo(x, wy);
  }
  ctx.strokeStyle = "#c1e9d8";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.globalAlpha = .26;
  ctx.strokeStyle = "#cff5e4";
  ctx.lineWidth = 2;
  for (let i = 0; i < 17; i++) {
    const x = ((i * 113 - scroll * .65) % (width + 120) + width + 120) % (width + 120) - 60;
    const ry = y + 24 + ((i * 37) % Math.max(30, 550 - y));
    ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x + 22 + i % 3 * 9, ry); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const coin of game.coins) {
    const x = coin.x - scroll;
    if (x < -20 || x > width + 20) continue;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(visualTime * 4 + coin.x) * .06;
    ctx.fillStyle = "#ffdc75";
    ctx.beginPath(); ctx.arc(x, coin.y, 12 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#b67c22"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#a87322"; ctx.font = "bold 14px system-ui"; ctx.textAlign = "center";
    ctx.fillText("·", x, coin.y + 4);
  }
  for (const gift of game.gifts) {
    const x = gift.x - scroll;
    if (x < -25 || x > width + 25) continue;
    rounded(x - 17, gift.y - 17, 34, 34, 5, "#b095dc");
    ctx.strokeStyle = "#49325d"; ctx.lineWidth = 3;
    ctx.strokeRect(x - 17, gift.y - 17, 34, 34);
    rounded(x - 3, gift.y - 17, 6, 34, 1, "#fff2a9");
    rounded(x - 17, gift.y - 3, 34, 6, 1, "#fff2a9");
    ctx.fillStyle = "#49325d"; ctx.font = "bold 18px system-ui"; ctx.textAlign = "center";
    ctx.fillText("?", x, gift.y - 20);
  }
  for (const sparkle of sparkles) {
    const progress = 1 - sparkle.life / .7;
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = "#fff2af"; ctx.strokeStyle = "#94621c";
    ctx.lineWidth = 3; ctx.font = "bold 18px system-ui"; ctx.textAlign = "center";
    const sy = sparkle.y - (reducedMotion ? 20 : progress * 45);
    ctx.strokeText("+1", sparkle.x - scroll, sy);
    ctx.fillText("+1", sparkle.x - scroll, sy);
  }
  ctx.globalAlpha = 1;
  const next = game.next;
  if (next) {
    const labelX = next.x - scroll + next.width / 2;
    const labelY = next.type === "rock" ? next.edge - 36 : 155;
    rounded(labelX - 38, labelY, 76, 24, 12, "#faf8e9");
    ctx.fillStyle = "#4f7062";
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(next.type === "rock" ? "HOLD ↑" : "RELEASE ↓", labelX, labelY + 16);
    const targetTop = next.type === "rock" ? next.edge - RULES.draft - 38 : next.edge + RULES.boatHeight + 12;
    ctx.strokeStyle = "#fff1a7";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(next.x - scroll - 26, targetTop, 18, 26);
    ctx.setLineDash([]);
  }
  const skin = SKINS[progress.data.selected];
  if (state === "crashing") drawCrash(skin);
  else if (!game.failure) drawBoat(skin);
  if (state === "running" && game.boostAmount > .01 && game.speed > game.baseSpeed) {
    ctx.save();
    ctx.globalAlpha = game.boostAmount;
    const length = 30 + game.boostAmount * (reducedMotion ? 25 : 55);
    const flicker = reducedMotion ? 0 : Math.sin(visualTime * 30) * 5;
    path([[RULES.boatX - 26, y + 3], [RULES.boatX - 26 - length - flicker, y + 8], [RULES.boatX - 26, y + 12]], "#ffae43", "#98501e");
    path([[RULES.boatX - 27, y + 5], [RULES.boatX - 27 - length * .65, y + 8], [RULES.boatX - 27, y + 10]], "#fff3ab");
    ctx.strokeStyle = "#f4fff0"; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const offset = reducedMotion ? 0 : (visualTime * 100 + i * 15) % 24;
      ctx.beginPath();
      ctx.moveTo(RULES.boatX - 35 - offset, y + 17 + i * 7);
      ctx.lineTo(RULES.boatX - 85 - offset, y + 17 + i * 7);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(RULES.boatX - 45 - offset, y + 14 + i * 7, 2.5, 0, Math.PI * 2); ctx.fillStyle = "#f4fff0"; ctx.fill();
    }
    ctx.restore();
  }
  rounded(20, 240, 6, 235, 3, "#eff7e651");
  rounded(20, y - 4, 6, 8, 3, "#fff5d6");
}

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
  lastTime = time;
  if (state === "running") {
    visualTime += dt;
    game.update(dt, holding(), boosting());
    const boostLabel = game.boostAmount > 0 ? ` · BOOST ${(game.speed / game.baseSpeed).toFixed(2)}×` : "";
    $("flow").textContent = `Flow ${Math.round(game.progression * 100)}% · ${(game.baseSpeed / game.difficulty.startSpeed).toFixed(2)}×${boostLabel}`;
    if (holding() !== wasHolding) {
      if (visualTime - lastTideSound > .25) {
        sound.play(holding() ? "rise" : "fall");
        lastTideSound = visualTime;
      }
      wasHolding = holding();
    }
    if (boosting() !== wasBoosting) {
        if (boosting()) sound.play("boost");
        wasBoosting = boosting();
    }
    sparkles = sparkles.filter(sparkle => (sparkle.life -= dt) > 0);
    if (game.pickups.length || game.passEvents.length || game.giftEvents.length) {
      try {
        const earned = progress.recordRun(game, runId);
        if (earned.length) {
          $("mission-feedback").textContent = earned.map(mission => `${mission.label}${mission.reward ? ` complete! +${mission.reward} coins.` : "."}`).join(" ");
          $("announcement").textContent = $("mission-feedback").textContent;
        }
      } catch (error) {
        pause();
        $("notice").textContent = `Couldn't record this run: ${error.message}`;
        console.warn("Tiny Tide run progress failed:", error);
      }
      renderProgress();
    }
    for (const gift of game.giftEvents) {
      sound.play("gift");
      $("announcement").textContent = `${GIFTS[gift.effect].label} collected.`;
    }
    if (game.pickups.length) {
      $("run-coins").textContent = String(game.collected);
      $("coin-feedback").textContent = `+${game.pickups.length} coin${game.pickups.length === 1 ? "" : "s"} · Nice catch!`;
      feedbackTime = 1.4;
      sparkles.push(...game.pickups.map(coin => ({ ...coin, life: .7 })));
      sound.play("coin");
    } else if (feedbackTime > 0) {
      feedbackTime -= dt;
      if (feedbackTime <= 0) $("coin-feedback").textContent = "Follow the gold. Find your flow.";
    }
    const effect = game.effect;
    const feedback = game.giftFeedback;
    const giftStatus = $("gift-status");
    giftStatus.hidden = !effect && !feedback && game.handoff <= 0;
    if (effect) {
      const info = GIFTS[effect.type];
      giftStatus.style.borderColor = info.color;
      const warning = effect.type === "autopilot" && effect.remaining <= 2
        ? " · Take control soon; finishing safe passage" : "";
      giftStatus.textContent = `${info.icon} ${info.label} · ${Math.ceil(effect.remaining)}s${warning}`;
    } else if (game.handoff > 0) {
      giftStatus.style.borderColor = GIFTS.autopilot.color;
      giftStatus.textContent = `Take control now · gentle pace ${Math.ceil(game.handoff)}s · Hold to rise, release to fall`;
    } else if (feedback) {
      const info = GIFTS[feedback.type];
      giftStatus.style.borderColor = info.color;
      giftStatus.textContent = feedback.type === "coins" ? "+10 coins saved to bank" : `${info.icon} ${info.label} ended`;
    }
    for (const pass of game.passEvents) {
      $("combo").textContent = pass.perfect
        ? `Perfect! Combo ${pass.combo} · +${pass.bonus} points`
        : "Safe passage · combo reset. Aim for the gold band.";
      if (pass.perfect) sound.play("perfect");
    }
    $("score").textContent = String(game.score);
    const next = game.next;
    $("next").textContent = next ? `${next.type === "rock" ? "↑ Hold · rock" : "↓ Release · bridge"}${next.x - game.distance > width ? " ahead" : ""}` : "Find your flow";
    $("tide").classList.toggle("active", holding());
    $("boost").classList.toggle("active", boosting());
    $("boost").setAttribute("aria-pressed", String(boosting()));
    if (game.failure) beginCrash();
  } else if (state === "crashing") {
    crashTime += dt;
    if (crashTime >= crashDuration) finish();
  }
  if (state !== "running" && state !== "paused" && shownGoalDate !== utcDate()) {
    updateBestPreview();
    renderProgress();
  }
  draw();
  applyUpdateWhenSafe();
  requestAnimationFrame(frame);
}
resize();
requestAnimationFrame(frame);

async function prepareOffline() {
  const status = $("connection");
  if (!("serviceWorker" in navigator)) {
    status.textContent = "Offline play unavailable in this browser";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    const worker = registration.installing || registration.waiting || registration.active;
    const updateStatus = () => {
      if (worker?.state === "activated") status.textContent = "Offline ready · no ads, just flow";
      else if (worker?.state === "redundant") status.textContent = "Offline setup failed. Reload online to retry.";
    };
    worker?.addEventListener("statechange", updateStatus);
    updateStatus();
  } catch (error) {
    status.textContent = "Offline setup unavailable. Play online for now.";
    console.error("Tiny Tide offline setup failed:", error);
  }
}
prepareOffline();
