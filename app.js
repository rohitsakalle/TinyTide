import { TideGame, RULES, MODES, minimumViewWidth, waterY, sceneryState } from "./engine.js";
import { TideSound } from "./sound.js";
import { ProgressStore, SKINS, MISSIONS, utcDate, dailyRandom } from "./progress.js";

const $ = id => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const game = new TideGame();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let state = "ready";
let width = 900;
let lastTime = 0;
let visualTime = 0;
let best = 0;
let runDate = null;
let runCourse = "endless";
const bests = { easy: 0, medium: 0, fast: 0 };
let muted = false;
let sparkles = [];
let feedbackTime = 0;
let wasHolding = false;
let lastTideSound = -Infinity;
let storageAvailable = true;
const pointers = new Set();
const keys = new Set();
const holding = () => pointers.size > 0 || keys.size > 0;

try {
  const saved = Number(localStorage.getItem("tiny-tide-best") || 0);
  best = Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
  for (const mode of Object.keys(MODES)) {
    const stored = localStorage.getItem(`tiny-tide-best-${mode}`);
    const value = Number(stored);
    bests[mode] = stored !== null && Number.isSafeInteger(value) && value >= 0 ? value : mode === "medium" ? best : 0;
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
  $("daily-date").hidden = !daily;
  $("daily-date").textContent = `${utcDate()} UTC · fixed Medium`;
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
    button.textContent = progress.data.selected === id ? "Selected" : owned ? "Select" : `Unlock · ${SKINS[id].price} coins`;
    button.setAttribute("aria-label", `${SKINS[id].name}: ${button.textContent}`);
    button.disabled = !progress.persistent || (state !== "ready" && state !== "over") || progress.data.selected === id || (!owned && coinBank() < SKINS[id].price);
  }
  $("missions").replaceChildren(...MISSIONS.map(mission => {
    const item = document.createElement("li");
    const completed = progress.data.completed.includes(mission.id);
    item.textContent = `${mission.label}: ${completed ? "Complete" : `${Math.min(mission.target, game[mission.metric])}/${mission.target}`} · ${mission.reward} coins${completed ? " paid" : " reward"}`;
    return item;
  }));
  const next = MISSIONS.find(mission => !progress.data.completed.includes(mission.id));
  $("mission-summary").textContent = next ? `${next.label} · ${Math.min(next.target, game[next.metric])}/${next.target}` : "All missions complete!";
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
  pointers.clear();
  keys.clear();
  $("tide").classList.remove("active");
}

function start() {
  sound.stop();
  runCourse = $("course").value;
  runDate = runCourse === "daily" ? utcDate() : null;
  game.random = runDate ? dailyRandom(runDate) : Math.random;
  game.reset(runDate ? "medium" : $("mode").value);
  best = runDate ? progress.data.dailyBests[runDate] || 0 : bests[game.mode];
  $("best").textContent = `${best} pts`;
  $("mode").disabled = true;
  $("course").disabled = true;
  $("daily-date").textContent = runDate ? `${runDate} UTC · fixed Medium` : "";
  resize();
  sparkles = [];
  feedbackTime = 0;
  wasHolding = false;
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
  $("pause").textContent = "Ⅱ";
  $("pause").setAttribute("aria-label", "Pause game");
  canvas.focus({ preventScroll: true });
  playFromGesture("start");
}

function finish() {
  state = "over";
  clearInput();
  sound.stop();
  sound.play("finish");
  $("pause").disabled = true;
  $("mode").disabled = runCourse === "daily";
  $("course").disabled = false;
  $("tide").disabled = true;
  const record = game.score > best;
  if (record) {
    best = game.score;
    $("best").textContent = `${best} pts`;
    if (runDate) progress.recordDaily(runDate, best);
    else {
      bests[game.mode] = best;
      save(`tiny-tide-best-${game.mode}`, best);
      if (game.mode === "medium") save("tiny-tide-best", best);
    }
  }
  const reason = game.failure === "rock" ? "A little too low. Hold earlier to clear the rocks." : "A little too high. Release earlier for the bridge.";
  showOverlay(record ? `A NEW ${runDate ? "DAILY" : MODES[game.mode].label.toUpperCase()} BEST` : "EVERY TIDE TEACHES YOU", `${game.score} flow points.`, reason, "Float again →", `${Math.floor(game.distance / 10)} m · ${game.bonus} bonus points · ${game.collected} coins · Space to retry`);
  $("announcement").textContent = `${game.score} points. ${reason}`;
  renderProgress();
}

$("play").addEventListener("click", () => state === "paused" ? resume() : start());
$("pause").addEventListener("click", () => state === "paused" ? resume() : pause());
for (const element of [canvas, $("tide")]) {
  element.addEventListener("pointerdown", event => {
    if (event.button !== 0 || state !== "running") return;
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    pointers.add(event.pointerId);
    sound.unlock();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    element.addEventListener(name, event => pointers.delete(event.pointerId));
  }
  element.addEventListener("contextmenu", event => event.preventDefault());
}
window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLSelectElement || (event.target instanceof Element && event.target.closest("#studio"))) return;
  if (event.code === "KeyP" || event.code === "Escape") {
    if (event.repeat) return;
    event.preventDefault();
    if (state === "running") pause();
    else if (state === "paused") resume();
    return;
  }
  if (!["Space", "ArrowUp"].includes(event.code)) return;
  if (event.code === "Space" && event.target instanceof HTMLButtonElement && event.target !== $("tide")) return;
  event.preventDefault();
  if (event.repeat) return;
  if (state === "paused") resume();
  else if (state !== "running") start();
  keys.add(event.code);
});
window.addEventListener("keyup", event => keys.delete(event.code));
window.addEventListener("blur", () => { pause(); sound.stop(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); sound.stop(); } });

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
  { name: "Garden canal", sky: "#e5edde", cloud: "#dae5d3", tree: "#b8ceaf", bank: "#bfceae", water: "#67b5ab", deep: "#327f7c" },
  { name: "Rainy streets", sky: "#c5d3d9", cloud: "#adbfc9", tree: "#879d9c", bank: "#a9b3a5", water: "#65a5b2", deep: "#356878" },
  { name: "Moonlit water", sky: "#334958", cloud: "#425d6a", tree: "#607c79", bank: "#7c9385", water: "#619cac", deep: "#34566c" },
];
function mixColor(a, b, t) {
  const channels = [1, 3, 5].map(offset => Math.round(parseInt(a.slice(offset, offset + 2), 16) * (1 - t) + parseInt(b.slice(offset, offset + 2), 16) * t));
  return `rgb(${channels.join(",")})`;
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
      path([[x - 5, 550], [x + 2, obstacle.edge + 31], [x + 22, obstacle.edge], [x + 43, obstacle.edge + 6], [x + obstacle.width, obstacle.edge + 39], [x + obstacle.width + 10, 550]], "#829284", "#6f8275");
      path([[x + 22, obstacle.edge], [x + 28, obstacle.edge + 47], [x + obstacle.width, obstacle.edge + 39], [x + 43, obstacle.edge + 6]], "#96a295");
    } else {
      rounded(x, 194, obstacle.width, obstacle.edge - 194, 5, "#a88363");
      rounded(x, obstacle.edge - 20, obstacle.width, 20, 3, "#81654f");
      ctx.strokeStyle = "#bc9a77";
      ctx.lineWidth = 2;
      for (let by = 213; by < obstacle.edge - 20; by += 24) {
        ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + obstacle.width, by); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + (by % 48 ? 25 : 62), by); ctx.lineTo(x + (by % 48 ? 25 : 62), by - 23); ctx.stroke();
      }
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
  ctx.save();
  ctx.translate(RULES.boatX, y);
  const skin = SKINS[progress.data.selected];
  ctx.fillStyle = "#27696235";
  ctx.beginPath(); ctx.ellipse(0, 18, 38, 6, 0, 0, Math.PI * 2); ctx.fill();
  path([[-26, -3], [26, -3], [14, 9], [-15, 9]], "#f5ecd4", "#e0d4b8");
  path([[-22, -4], [-2, -39], [-2, -4]], skin.sail);
  path([[0, -37], [21, -5], [0, -5]], skin.fold);
  path([[-26, -3], [0, 3], [26, -3], [14, 9], [-15, 9]], skin.hull);
  ctx.restore();
  rounded(20, 240, 6, 235, 3, "#eff7e651");
  rounded(20, y - 4, 6, 8, 3, "#fff5d6");
}

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
  lastTime = time;
  if (state === "running") {
    visualTime += dt;
    game.update(dt, holding());
    $("flow").textContent = `Flow ${Math.round(game.progression * 100)}% · ${(game.speed / game.difficulty.startSpeed).toFixed(2)}×`;
    if (holding() !== wasHolding) {
      if (visualTime - lastTideSound > .25) {
        sound.play(holding() ? "rise" : "fall");
        lastTideSound = visualTime;
      }
      wasHolding = holding();
    }
    sparkles = sparkles.filter(sparkle => (sparkle.life -= dt) > 0);
    if (game.pickups.length || game.passEvents.length) {
      const earned = progress.recordRun(game, game.pickups.length);
      if (earned.length) {
        $("mission-feedback").textContent = earned.map(mission => `${mission.label} complete! +${mission.reward} coins.`).join(" ");
        $("announcement").textContent = $("mission-feedback").textContent;
      }
      renderProgress();
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
    if (game.failure) finish();
  }
  draw();
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
