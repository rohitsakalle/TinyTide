import { TideGame, RULES, MODES, minimumViewWidth, waterY } from "./engine.js";
import { TideSound } from "./sound.js";

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
const bests = { easy: 0, medium: 0, fast: 0 };
let coinBank = 0;
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
  const savedCoins = Number(localStorage.getItem("tiny-tide-coins") || 0);
  coinBank = Number.isSafeInteger(savedCoins) && savedCoins >= 0 ? savedCoins : 0;
  muted = localStorage.getItem("tiny-tide-muted") === "true";
} catch (error) {
  storageAvailable = false;
  $("notice").textContent = "Private storage is unavailable. Scores, coins and settings last for this visit.";
  console.warn("Tiny Tide could not read local storage:", error);
}
$("best").textContent = `${best} m`;
$("coin-bank").textContent = String(coinBank);
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
$("mode").addEventListener("change", () => {
  if (state !== "ready" && state !== "over") {
    $("mode").value = game.mode;
    return;
  }
  best = bests[$("mode").value];
  $("best").textContent = `${best} m`;
});
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
  game.reset($("mode").value);
  best = bests[game.mode];
  $("mode").disabled = true;
  resize();
  sparkles = [];
  feedbackTime = 0;
  wasHolding = false;
  lastTideSound = -Infinity;
  $("run-coins").textContent = "0";
  $("coin-feedback").textContent = "Follow the gold. Find your flow.";
  clearInput();
  state = "running";
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
  $("mode").disabled = false;
  $("tide").disabled = true;
  const record = game.score > best;
  if (record) {
    best = game.score;
    bests[game.mode] = best;
    $("best").textContent = `${best} m`;
    save(`tiny-tide-best-${game.mode}`, best);
    if (game.mode === "medium") save("tiny-tide-best", best);
  }
  const reason = game.failure === "rock" ? "A little too low. Hold earlier to clear the rocks." : "A little too high. Release earlier for the bridge.";
  showOverlay(record ? `A NEW ${MODES[game.mode].label.toUpperCase()} BEST` : "EVERY TIDE TEACHES YOU", `${game.score} little metres.`, reason, "Float again →", `${game.collected} coins this run · ${coinBank} in your bank · Space to retry`);
  $("announcement").textContent = `${game.score} metres. ${reason}`;
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
  if (event.target instanceof HTMLSelectElement) return;
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

function draw() {
  ctx.clearRect(0, 0, width, RULES.height);
  ctx.fillStyle = "#e5edde";
  ctx.fillRect(0, 0, width, RULES.height);
  const scroll = game.distance;
  for (let i = -1; i < width / 180 + 2; i++) {
    const x = i * 180 - (scroll * .22 % 180);
    rounded(x, 125 + Math.sin(i * 3) * 15, 125, 50, 25, "#dae5d3");
    rounded(x + 40, 100 + Math.sin(i * 3) * 15, 70, 60, 30, "#dae5d3");
    ctx.fillStyle = "#bfd2bb";
    ctx.fillRect(x + 60, 190, 3, 25);
    path([[x + 61, 150], [x + 37, 197], [x + 85, 197]], "#b8ceaf");
    path([[x + 111, 170], [x + 92, 207], [x + 130, 207]], "#c7d9bb");
  }
  ctx.fillStyle = "#d0ddc4";
  ctx.fillRect(0, 218, width, 382);
  ctx.fillStyle = "#bfceae";
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
  water.addColorStop(0, "#67b5abdd");
  water.addColorStop(1, "#327f7cf2");
  ctx.fillStyle = water;
  ctx.fillRect(0, y, width, RULES.height - y);
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
  }
  ctx.save();
  ctx.translate(RULES.boatX, y);
  ctx.fillStyle = "#27696235";
  ctx.beginPath(); ctx.ellipse(0, 18, 38, 6, 0, 0, Math.PI * 2); ctx.fill();
  path([[-26, -3], [26, -3], [14, 9], [-15, 9]], "#f5ecd4", "#e0d4b8");
  path([[-22, -4], [-2, -39], [-2, -4]], "#fffbed");
  path([[0, -37], [21, -5], [0, -5]], "#e8d9ba");
  path([[-26, -3], [0, 3], [26, -3], [14, 9], [-15, 9]], "#ebad70");
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
    if (holding() !== wasHolding) {
      if (visualTime - lastTideSound > .25) {
        sound.play(holding() ? "rise" : "fall");
        lastTideSound = visualTime;
      }
      wasHolding = holding();
    }
    sparkles = sparkles.filter(sparkle => (sparkle.life -= dt) > 0);
    if (game.pickups.length) {
      coinBank = Math.min(Number.MAX_SAFE_INTEGER, coinBank + game.pickups.length);
      save("tiny-tide-coins", coinBank);
      $("coin-bank").textContent = String(coinBank);
      $("run-coins").textContent = String(game.collected);
      $("coin-feedback").textContent = `+${game.pickups.length} coin${game.pickups.length === 1 ? "" : "s"} · Nice catch!`;
      feedbackTime = 1.4;
      sparkles.push(...game.pickups.map(coin => ({ ...coin, life: .7 })));
      sound.play("coin");
    } else if (feedbackTime > 0) {
      feedbackTime -= dt;
      if (feedbackTime <= 0) $("coin-feedback").textContent = "Follow the gold. Find your flow.";
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
