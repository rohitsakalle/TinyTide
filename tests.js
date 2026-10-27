import { TideGame, RULES, MODES, minimumViewWidth, waterY, sceneryState } from "./engine.js";
import { TideSound } from "./sound.js";
import { ProgressStore, PROGRESS_KEY, SKINS, MISSIONS, utcDate, dailyRandom } from "./progress.js";

function assert(condition, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}
function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}
function advance(game, seconds, hold, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) game.update(1 / fps, hold);
}

export function runTests() {
  const results = [];
  let passed = 0;
  function test(name, fn) {
    try { fn(); passed++; results.push(`PASS ${name}`); }
    catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
  }
  test("Bounded water with limited adjustment speed", () => {
    const game = new TideGame();
    const initial = game.lift;
    game.update(.1, true);
    assert(Math.abs(game.lift - initial - RULES.tideRate * .1) < 1e-10);
    advance(game, 1, true);
    assert(game.lift === 1);
    advance(game, 2, false);
    assert(game.lift === 0);
    assert(waterY(0) === RULES.lowWater && waterY(1) === RULES.lowWater - RULES.travel);
  });
  for (const type of ["rock", "bridge"]) {
    test(`${type}: unsafe collision and safe passage`, () => {
      for (const safe of [false, true]) {
        const game = new TideGame();
        game.lift = type === "rock" ? (safe ? 1 : 0) : (safe ? 0 : 1);
        game.obstacles = [{ type, x: RULES.boatX, width: 80, edge: 340, passed: false }];
        game.update(1 / 60, type === "rock" ? safe : !safe);
        assert(game.failure === (safe ? null : type));
      }
    });
  }
  test("Scoring, collision freeze, restart and deterministic opening", () => {
    const game = new TideGame();
    advance(game, 2, true);
    assert(game.score > 0);
    game.failure = "rock";
    const distance = game.distance;
    game.update(.1, false);
    assert(game.distance === distance);
    game.reset();
    assert(game.score === 0 && game.passed === 0 && game.failure === null);
    game.update(.01, true);
    assert(game.obstacles[0].type === "rock" && game.obstacles[1].type === "bridge");
  });
  test("30, 60 and 120 Hz produce equivalent motion", () => {
    const games = [30, 60, 120].map(fps => {
      const game = new TideGame(seeded(5));
      advance(game, 2, true, fps);
      return game;
    });
    for (const game of games) {
      assert(Math.abs(game.distance - games[0].distance) < .02);
      assert(Math.abs(game.lift - games[0].lift) < 1e-9);
    }
  });
  test("Invalid time rejected, long stalls capped", () => {
    const game = new TideGame();
    for (const dt of [-1, NaN, Infinity]) {
      let rejected = false;
      try { game.update(dt, true); } catch (error) { rejected = error instanceof RangeError; }
      assert(rejected);
    }
    game.update(20, true);
    assert(game.distance < 20);
  });
  test("Smallest viewport gives a full transition plus 0.5s warning", () => {
    for (const mode of Object.keys(MODES)) {
      const lead = minimumViewWidth(mode) - RULES.boatX - RULES.boatHalfWidth;
      assert(lead / MODES[mode].maxSpeed >= 1 / RULES.tideRate + .5);
    }
  });
  test("All modes ramp smoothly to a bounded cap over 90 active seconds and reset", () => {
    for (const mode of Object.keys(MODES)) {
      const game = new TideGame(seeded(6), mode);
      let previousSpeed = game.speed;
      let atHalf;
      for (let frame = 0; frame < 60 * 105; frame++) {
        game.update(1 / 60, game.next?.type === "rock");
        assert(!game.failure, `${mode}: ramp run failed`);
        assert(game.speed >= previousSpeed && game.speed <= MODES[mode].maxSpeed);
        assert(game.speed - previousSpeed < .025, "Abrupt speed change");
        if (frame === 2699) atHalf = game.speed;
        previousSpeed = game.speed;
      }
      assert(Math.abs(atHalf - (MODES[mode].startSpeed + MODES[mode].maxSpeed) / 2) < .001);
      assert(game.progression === 1 && game.speed === MODES[mode].maxSpeed);
      const elapsed = game.elapsed;
      game.failure = "rock";
      game.update(.1, true);
      assert(game.elapsed === elapsed, "Failure advanced progression");
      game.reset();
      assert(game.elapsed === 0 && game.progression === 0 && game.speed === MODES[mode].startSpeed);
    }
  });
  test("Later patterns tighten clearance, widen hazards and require more alternating tides", () => {
    for (const mode of Object.keys(MODES)) {
      const opening = new TideGame(() => .2, mode);
      const late = new TideGame(() => .2, mode);
      late.elapsed = RULES.progressionSeconds;
      assert(late.obstacleGap < opening.obstacleGap);
      for (const type of ["rock", "bridge"]) {
        opening.spawnCount = late.spawnCount = 0;
        opening.lastType = late.lastType = type === "rock" ? "bridge" : "rock";
        const earlyObstacle = opening.spawn(3000);
        const lateObstacle = late.spawn(3000);
        assert(lateObstacle.width > earlyObstacle.width);
        assert(type === "rock" ? lateObstacle.edge < earlyObstacle.edge : lateObstacle.edge > earlyObstacle.edge);
        const safeSurface = waterY(type === "rock" ? 1 : 0);
        assert(type === "rock" ? safeSurface + RULES.draft < lateObstacle.edge : safeSurface - RULES.boatHeight > lateObstacle.edge);
      }
      opening.spawnCount = late.spawnCount = 2;
      opening.lastType = late.lastType = "rock";
      assert(opening.spawn(4000).type === "rock" && late.spawn(4000).type === "bridge");
      const transitionBudget = (late.obstacleGap - 2 * RULES.boatHalfWidth - 90) / MODES[mode].maxSpeed;
      assert(transitionBudget >= 1 / RULES.tideRate + .25);
    }
  });
  test("Perfect exits earn consecutive capped bonuses; safe non-perfect exits break the combo", () => {
    const game = new TideGame(() => .5);
    function exit(type, clearance) {
      game.lift = (RULES.lowWater - (type === "rock" ? 340 - RULES.draft - clearance : 340 + RULES.boatHeight + clearance)) / RULES.travel;
      game.obstacles = [{ type, x: game.distance + RULES.boatX - RULES.boatHalfWidth - 5, width: 8, edge: 340, passed: false }];
      let event;
      for (let tick = 0; tick < 5 && !event; tick++) {
        game.update(1 / 120, type === "rock");
        event = game.passEvents[0];
      }
      assert(!game.failure && event, "Did not make safe exit");
      return event;
    }
    for (let combo = 1; combo <= 7; combo++) {
      const event = exit(combo % 2 ? "rock" : "bridge", 25);
      assert(event.perfect && event.combo === combo && event.bonus === 5 * Math.min(combo, 5));
    }
    assert(game.perfects === 7 && game.bonus === 125);
    const safe = exit("bridge", 65);
    assert(!safe.perfect && game.combo === 0 && game.bonus === 125);
    assert(exit("rock", 25).bonus === 5);
    game.reset();
    assert(game.combo === 0 && game.bonus === 0 && game.perfects === 0 && game.passEvents.length === 0);
  });
  test("Daily UTC seed and fixed ticks reproduce obstacles and coins across frame timings", () => {
    assert(utcDate(new Date("2026-10-28T00:30:00+02:00")) === "2026-10-27");
    const snapshots = [];
    for (const timing of [[1 / 30], [1 / 60], [1 / 120], [1 / 120, 1 / 40]]) {
      const game = new TideGame(dailyRandom("2026-10-27"), "medium");
      // Same input at fixed 0.1s boundaries, independent of render timing.
      for (let segment = 0; segment < 1200 && !game.failure; segment++) {
        const hold = game.next?.type === "rock";
        const pieces = timing.length === 1 ? Array(Math.round(.1 / timing[0])).fill(timing[0]) : Array(3).fill(timing).flat();
        for (const dt of pieces) game.update(dt, hold);
      }
      assert(!game.failure, "Daily safe route failed");
      snapshots.push(JSON.stringify({ distance: game.distance, elapsed: game.elapsed, obstacles: game.obstacles, coins: game.coins, collected: game.collected, score: game.score }));
    }
    assert(snapshots.every(snapshot => snapshot === snapshots[0]), "Display timing changed daily course");
    const first = new TideGame(dailyRandom("2026-10-27"));
    const second = new TideGame(dailyRandom("2026-10-28"));
    assert(first.obstacles[0].edge !== second.obstacles[0].edge, "Next UTC day did not change course");
  });
  test("Scenery transitions are continuous, bounded and do not alter game state", () => {
    assert(sceneryState(0).from === 0 && sceneryState(60).from === 1 && sceneryState(95).from === 2);
    const game = new TideGame();
    const original = JSON.stringify(game);
    for (let elapsed = 0; elapsed <= 120; elapsed += .1) {
      const scene = sceneryState(elapsed);
      assert(scene.blend >= 0 && scene.blend <= 1 && scene.from <= scene.to);
      const following = sceneryState(elapsed + .001);
      assert(Math.abs(scene.from + scene.blend - following.from - following.blend) < .001);
    }
    assert(JSON.stringify(game) === original);
  });
  test("Coin migration, atomic boat purchases, ownership and mission payouts survive reload", () => {
    const values = new Map([["tiny-tide-coins", "80"]]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const store = new ProgressStore(storage);
    assert(store.data.coins === 80 && store.data.selected === "paper");
    store.chooseSkin("mint");
    assert(store.data.coins === 55 && store.data.selected === "mint" && store.data.owned.includes("mint"));
    store.chooseSkin("mint");
    assert(store.data.coins === 55, "Owned boat was charged twice");
    store.chooseSkin("berry");
    assert(store.data.coins === 5);
    const reloaded = new ProgressStore(storage);
    assert(reloaded.data.coins === 5 && reloaded.data.selected === "berry");
    const run = { collected: 10, passed: 5, perfects: 3 };
    assert(reloaded.recordRun(run, 1).length === 3);
    assert(reloaded.data.coins === 51 && reloaded.data.completed.length === 3);
    assert(reloaded.recordRun(run, 0).length === 0 && reloaded.data.coins === 51);
    const again = new ProgressStore(storage);
    assert(again.recordRun(run, 0).length === 0 && again.data.coins === 51);
    again.recordDaily("2026-10-27", 42);
    again.recordDaily("2026-10-27", 12);
    again.recordDaily("2026-10-28", 99);
    assert(again.data.dailyBests["2026-10-27"] === 42 && again.data.dailyBests["2026-10-28"] === 99);
    assert(values.get("tiny-tide-coins") === "80", "Migration modified legacy data");
    assert(Object.keys(SKINS).length === 3 && MISSIONS.length === 3);
  });
  test("Insufficient funds, failed saves and invalid progress never spend coins or grant boats", () => {
    const values = new Map([["tiny-tide-coins", "25"]]);
    let failSave = false;
    let errors = 0;
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (failSave) throw Error("Storage full"); values.set(key, value); } };
    const store = new ProgressStore(storage, () => errors++);
    let rejected = 0;
    try { store.chooseSkin("berry"); } catch { rejected++; }
    assert(rejected === 1 && store.data.coins === 25);
    failSave = true;
    try { store.chooseSkin("mint"); } catch { rejected++; }
    assert(rejected === 2 && store.data.coins === 25 && store.data.selected === "paper" && store.data.owned.length === 1);
    assert(!values.has(PROGRESS_KEY) && errors === 1);
    values.set(PROGRESS_KEY, "{invalid");
    const corrupt = new ProgressStore(storage, () => errors++);
    assert(!corrupt.persistent && values.get(PROGRESS_KEY) === "{invalid");
    try { corrupt.chooseSkin("paper"); } catch { rejected++; }
    assert(rejected === 3);
    failSave = false;
    values.delete(PROGRESS_KEY);
    const firstTab = new ProgressStore(storage);
    const otherTab = new ProgressStore(storage);
    firstTab.chooseSkin("mint");
    otherTab.chooseSkin("mint");
    assert(otherTab.data.coins === 0, "Stale tab spent or restored an outdated bank");
  });
  test("Coin pickups require proximity, award once, miss safely and reset", () => {
    const game = new TideGame();
    game.coins = [{ x: RULES.boatX, y: waterY(game.lift) - 18 }, { x: RULES.boatX, y: 200 }];
    game.update(1 / 120, true);
    assert(game.collected === 1 && game.pickups.length === 1);
    game.update(1 / 120, true);
    assert(game.collected === 1 && game.pickups.length === 0);
    game.coins.push({ x: -100, y: 400 });
    game.update(1 / 120, true);
    assert(game.coins.every(coin => coin.x > -50));
    game.reset();
    assert(game.collected === 0 && game.pickups.length === 0 && game.coins.length === 3);
    game.failure = "rock";
    game.coins = [{ x: RULES.boatX, y: waterY(game.lift) - 18 }];
    game.update(.1, true);
    assert(game.collected === 0);
  });
  test("All modes have distinct speeds, fair warning and reachable coin trails", () => {
    const speeds = [];
    for (const mode of Object.keys(MODES)) {
      speeds.push(MODES[mode].startSpeed);
      assert((minimumViewWidth(mode) - RULES.boatX - RULES.boatHalfWidth) / MODES[mode].maxSpeed >= 1 / RULES.tideRate + .5);
      for (let seed = 1; seed <= 30; seed++) {
        const game = new TideGame(seeded(seed), mode);
        if (seed % 2 === 0) {
          game.distance = 20000;
          game.elapsed = RULES.progressionSeconds;
          game.obstacles = [];
          game.coins = [];
          game.spawn(game.distance + 720);
        }
        for (let frame = 0; frame < 60 * 100; frame++) {
          const coins = game.coins.slice();
          game.update(1 / 60, game.next?.type === "rock");
          assert(game.failure === null, `${mode}, seed ${seed}, frame ${frame}`);
          assert(coins.every(coin => coin.collected || coin.x > game.distance - 50), `${mode}: missed a safe-path coin`);
        }
        assert(game.collected >= game.passed * 3, `${mode}: coin trail was unreachable`);
      }
    }
    assert(speeds[0] < speeds[1] && speeds[1] < speeds[2]);
    const game = new TideGame();
    let rejected = false;
    try { game.reset("unknown"); } catch (error) { rejected = error instanceof RangeError; }
    assert(rejected);
  });
  test("200 seeded runs: 100 seconds of reachable obstacles, including max speed", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const game = new TideGame(seeded(seed));
      if (seed % 2 === 0) {
        game.distance = 12000;
        game.elapsed = RULES.progressionSeconds;
        game.obstacles = [];
        game.spawn(game.distance + 720);
      }
      let previous;
      for (let frame = 0; frame < 60 * 100; frame++) {
        const obstacle = game.next;
        if (obstacle && obstacle !== previous) {
          if (previous) {
            const gap = obstacle.x - previous.x - previous.width - 2 * RULES.boatHalfWidth;
            assert(gap / MODES.medium.maxSpeed > 1 / RULES.tideRate, `Insufficient gap, seed ${seed}`);
          }
          previous = obstacle;
        }
        game.update(1 / 60, obstacle?.type === "rock");
        assert(game.failure === null, `seed ${seed}, frame ${frame}, obstacle ${obstacle?.type}`);
      }
      assert(game.passed >= 15, `Too few obstacles, seed ${seed}`);
    }
  });
  return { passed, total: results.length, results };
}

export async function runBrowserTests() {
  const results = [];
  let passed = 0;
  const iframe = document.createElement("iframe");
  iframe.title = "Isolated game integration checks";
  iframe.style.cssText = "position:absolute;left:-10000px;top:0;width:390px;height:844px;border:0";
  const source = await (await fetch("./index.html")).text();
  const scheduler = `<base href="${new URL("./", location.href)}">
    <script>
      window.testFrame = null;
      window.testTime = performance.now();
      window.requestAnimationFrame = callback => { window.testFrame = callback; return 1; };
      window.testErrors = [];
      window.addEventListener("error", event => window.testErrors.push(event.message));
      window.addEventListener("unhandledrejection", event => window.testErrors.push(event.reason.message));
      window.audioStats = { created: 0, resumed: 0, notes: 0, stopped: 0 };
      window.AudioContext = class {
        constructor() { window.audioStats.created++; this.state = "suspended"; this.currentTime = 0; this.destination = {}; }
        async resume() { window.audioStats.resumed++; this.state = "running"; }
        createOscillator() {
          return { frequency: {setValueAtTime() {}}, connect() {}, disconnect() {},
            start() { window.audioStats.notes++; }, stop() { window.audioStats.stopped++; } };
        }
        createGain() {
          return {gain: {setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}, disconnect() {}};
        }
      };
    <\/script>
    <script type="module">
      import { TideGame } from "./engine.js";
      const update = TideGame.prototype.update;
      TideGame.prototype.update = function(...args) {
        window.testGame = this;
        return update.apply(this, args);
      };
    <\/script>`;
  iframe.srcdoc = source.replace("<head>", `<head>${scheduler}`);
  const loaded = new Promise((resolve, reject) => {
    iframe.onload = resolve;
    iframe.onerror = () => reject(new Error("Integration frame failed to load"));
  });
  const storageKeys = ["tiny-tide-best", "tiny-tide-best-easy", "tiny-tide-best-medium", "tiny-tide-best-fast", "tiny-tide-coins", "tiny-tide-muted", PROGRESS_KEY];
  const originals = new Map(storageKeys.map(key => [key, localStorage.getItem(key)]));
  for (const key of storageKeys) localStorage.removeItem(key);
  localStorage.setItem("tiny-tide-best", "37");
  localStorage.setItem("tiny-tide-coins", "10");
  document.body.append(iframe);
  try {
    await loaded;
    let win = iframe.contentWindow;
    let doc = iframe.contentDocument;
    const el = id => doc.getElementById(id);
    const wait = () => new Promise(resolve => setTimeout(resolve, 60));
    function frames(count) {
      win.testTime = Math.max(win.testTime, win.performance.now());
      for (let i = 0; i < count; i++) {
        win.testTime += 1000 / 60;
        win.testFrame(win.testTime);
      }
    }
    function key(type, code) {
      el("game").dispatchEvent(new win.KeyboardEvent(type, { code, bubbles: true }));
    }
    function waterLine() {
      const canvas = el("game");
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(Math.floor(canvas.width * .4), 0, 1, canvas.height).data;
      for (let y = Math.floor(canvas.height * .38); y < canvas.height; y++) {
        const [r, g, b] = pixels.slice(y * 4, y * 4 + 3);
        if (r < 120 && g > 145 && b > 140) return y / canvas.height;
      }
      throw new Error("Water surface not found");
    }
    async function test(name, fn) {
      try { await fn(); passed++; results.push(`PASS ${name}`); }
      catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
    }
    await wait();
    await test("Legacy best maps to Medium, bank loads and no audio starts before gesture", () => {
      assert(el("best").textContent === "37 pts");
      assert(el("coin-bank").textContent === "10");
      assert(win.audioStats.created === 0 && win.audioStats.notes === 0);
    });
    await test("Responsive 320/390/844/1100px layouts fit without horizontal overflow", async () => {
      for (const width of [320, 390, 844, 1100]) {
        iframe.style.width = `${width}px`;
        iframe.style.height = width === 844 ? "390px" : "844px";
        await wait();
        assert(doc.documentElement.scrollWidth <= width, `Overflow at ${width}px`);
        assert(el("game").width > 0 && el("game").height > 0);
        assert(el("play").getBoundingClientRect().height >= 44);
        assert(el("tide").getBoundingClientRect().height >= 40);
      }
      iframe.style.width = "390px";
      await wait();
    });
    await test("Start, keyboard hold/release, and score update", () => {
      el("play").click();
      assert(el("overlay").hidden && !el("tide").disabled);
      const initial = waterLine();
      key("keydown", "Space");
      frames(50);
      assert(waterLine() < initial - .1, "Holding did not raise water");
      key("keyup", "Space");
      frames(50);
      assert(waterLine() > initial - .05, "Releasing did not lower water");
      assert(Number(el("score").textContent) > 0);
      el("tide").dispatchEvent(new win.KeyboardEvent("keydown", { code: "Space", bubbles: true }));
      frames(1);
      assert(el("tide").classList.contains("active"), "Focused tide button did not accept Space");
      key("keyup", "Space");
    });
    await test("Pause freezes score, resume clears held keys, blur pauses", () => {
      key("keydown", "ArrowUp");
      key("keydown", "KeyP");
      const score = el("score").textContent;
      const flow = el("flow").textContent;
      const scenery = el("scenery").textContent;
      frames(100);
      assert(!el("overlay").hidden && el("score").textContent === score);
      assert(el("flow").textContent === flow && el("scenery").textContent === scenery, "Pause advanced difficulty or scenery");
      el("play").click();
      frames(20);
      assert(!el("tide").classList.contains("active"), "Resume left input stuck");
      win.dispatchEvent(new win.Event("blur"));
      assert(!el("overlay").hidden && el("overlay-title").textContent === "A moment of calm.");
    });
    await test("Touch-pointer intent, multi-touch and cancellation clear correctly", () => {
      el("play").click();
      // Synthetic pointer events cannot create native capture; exercise input state in isolation.
      el("tide").setPointerCapture = () => {};
      function pointer(type, id) {
        el("tide").dispatchEvent(new win.PointerEvent(type, { pointerId: id, pointerType: "touch", button: 0, bubbles: true }));
      }
      pointer("pointerdown", 10);
      pointer("pointerdown", 11);
      frames(1);
      assert(el("tide").classList.contains("active"));
      pointer("pointercancel", 10);
      frames(1);
      assert(el("tide").classList.contains("active"), "Second finger was incorrectly cleared");
      pointer("lostpointercapture", 11);
      frames(1);
      assert(!el("tide").classList.contains("active"), "Cancelled touch remained held");
    });
    await test("Collision feedback, saved best and immediate retry", () => {
      frames(250);
      assert(!el("overlay").hidden && el("overlay-copy").textContent.includes("Hold earlier"));
      assert(Number(localStorage.getItem("tiny-tide-best")) > 0);
      key("keydown", "Space");
      frames(1);
      assert(el("overlay").hidden && Number(el("score").textContent) === 0);
      assert(el("flow").textContent === "Flow 0% · 1.00×");
      key("keyup", "Space");
      assert(win.testErrors.length === 0, win.testErrors.join("; "));
    });
    await test("Collect coins, persist immediately and keep balance across reload", async () => {
      key("keydown", "Space");
      frames(270);
      key("keyup", "Space");
      assert(el("run-coins").textContent === "3", "Expected opening trail's three coins");
      assert(el("coin-bank").textContent === "13");
      assert(JSON.parse(localStorage.getItem(PROGRESS_KEY)).coins === 13);
      assert(el("coin-feedback").textContent.includes("Nice catch"));
      el("pause").click();
      const reload = new Promise(resolve => iframe.onload = resolve);
      iframe.srcdoc = source.replace("<head>", `<head>${scheduler}`);
      await reload;
      win = iframe.contentWindow;
      doc = iframe.contentDocument;
      await wait();
      assert(el("coin-bank").textContent === "13" && el("run-coins").textContent === "0");
    });
    await test("Sound unlock, mute, unmute, pause and preference persistence", async () => {
      assert(win.audioStats.created === 0);
      el("play").click();
      await wait();
      assert(win.audioStats.created === 1 && win.audioStats.resumed === 1 && win.audioStats.notes > 0);
      el("sound").click();
      assert(el("sound").getAttribute("aria-pressed") === "true");
      const notes = win.audioStats.notes;
      key("keydown", "Space"); frames(240); key("keyup", "Space");
      assert(win.audioStats.notes === notes, "Muted game scheduled audio");
      assert(localStorage.getItem("tiny-tide-muted") === "true");
      el("sound").click();
      await wait();
      assert(win.audioStats.notes > notes, "Unmute did not restore audio");
      const stops = win.audioStats.stopped;
      el("pause").click();
      assert(win.audioStats.stopped > stops, "Pause did not cancel notes");
      el("sound").click();
      const reload = new Promise(resolve => iframe.onload = resolve);
      iframe.srcdoc = source.replace("<head>", `<head>${scheduler}`);
      await reload;
      win = iframe.contentWindow;
      doc = iframe.contentDocument;
      await wait();
      assert(el("sound").getAttribute("aria-pressed") === "true" && win.audioStats.created === 0);
    });
    await test("Easy/Medium/Fast selection locks during run and saves separate bests", () => {
      for (const mode of ["easy", "medium", "fast"]) {
        el("mode").value = mode;
        el("mode").dispatchEvent(new win.Event("change"));
        el("mode").dispatchEvent(new win.KeyboardEvent("keydown", { code: "ArrowUp", bubbles: true }));
        assert(!el("mode").disabled, "Selecting pace started the game");
        assert(el("best").textContent === (mode === "medium" ? `${localStorage.getItem("tiny-tide-best-medium") || 37} pts` : "0 pts"));
        el("play").click();
        assert(el("mode").disabled);
        el("mode").value = "fast";
        el("mode").dispatchEvent(new win.Event("change"));
        assert(el("mode").value === mode, "Mode changed mid-run");
        key("keydown", "KeyP");
        assert(el("mode").disabled, "Mode unlocked while paused");
        el("play").click();
        frames(500);
        assert(!el("mode").disabled && !el("overlay").hidden);
        const saved = Number(localStorage.getItem(`tiny-tide-best-${mode}`));
        assert(saved > 0 && el("best").textContent === `${saved} pts`);
      }
      assert(Number(localStorage.getItem("tiny-tide-best")) === Number(localStorage.getItem("tiny-tide-best-medium")));
      assert(win.testErrors.length === 0, win.testErrors.join("; "));
    });
    await test("Daily course uses fixed Medium, locks choices, saves only today's separate best", () => {
      el("course").value = "daily";
      el("course").dispatchEvent(new win.Event("change"));
      assert(el("mode").disabled && el("daily-date").textContent.includes(`${utcDate()} UTC`));
      const endlessBest = localStorage.getItem("tiny-tide-best-medium");
      el("play").click();
      frames(1);
      assert(win.testGame.mode === "medium" && el("course").disabled);
      const dateLabel = el("daily-date").textContent;
      el("course").value = "endless";
      el("course").dispatchEvent(new win.Event("change"));
      assert(el("course").value === "daily");
      frames(500);
      const data = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      assert(data.dailyBests[utcDate()] > 0 && !el("course").disabled && el("mode").disabled);
      assert(localStorage.getItem("tiny-tide-best-medium") === endlessBest, "Daily modified endless best");
      assert(el("daily-date").textContent === dateLabel);
    });
    await test("Long daily run pays missions once, shows progress, pauses scenery and resets on retry", () => {
      el("play").click();
      frames(1);
      function safeFrames(count) {
        let held = false;
        for (let frame = 0; frame < count; frame++) {
          const hold = win.testGame.next?.type === "rock";
          if (hold !== held) key(hold ? "keydown" : "keyup", "Space");
          held = hold;
          frames(1);
          assert(el("overlay").hidden, "Safe run unexpectedly ended");
        }
        key("keyup", "Space");
      }
      const initialBank = Number(el("coin-bank").textContent);
      safeFrames(2100);
      const run = win.testGame;
      const completed = JSON.parse(localStorage.getItem(PROGRESS_KEY)).completed;
      assert(run.collected >= 10 && run.passed >= 5);
      assert(completed.includes("coins10") && completed.includes("passes5"));
      assert(Number(el("coin-bank").textContent) === initialBank + run.collected + 25);
      assert(el("missions").textContent.includes("Complete") && el("mission-feedback").textContent.includes("complete!"));
      assert(el("flow").textContent !== "Flow 0% · 1.00×");
      key("keydown", "KeyP");
      const elapsed = run.elapsed;
      const flow = el("flow").textContent;
      frames(600);
      assert(run.elapsed === elapsed && el("flow").textContent === flow);
      assert(el("course").disabled && el("mode").disabled);
      el("play").click();
      run.failure = "rock";
      frames(1);
      const previousBank = Number(el("coin-bank").textContent);
      el("play").click();
      frames(1);
      assert(win.testGame.elapsed < .1 && win.testGame.bonus === 0 && el("scenery").textContent === "Garden canal");
      safeFrames(2100);
      assert(Number(el("coin-bank").textContent) === previousBank + win.testGame.collected, "Mission paid again on retry");
      win.testGame.failure = "rock";
      frames(1);
    });
    await test("Daily retries repeat the course and a UTC-midnight run keeps its starting date", () => {
      const OriginalDate = win.Date;
      let now = "2030-01-01T23:59:59.000Z";
      win.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
      };
      try {
        el("play").click(); frames(1);
        const opening = JSON.stringify({ obstacles: win.testGame.obstacles, coins: win.testGame.coins });
        frames(60);
        now = "2030-01-02T00:00:01.000Z";
        win.testGame.failure = "rock"; frames(1);
        const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
        assert(saved.dailyBests["2030-01-01"] > 0 && !saved.dailyBests["2030-01-02"]);
        assert(el("daily-date").textContent.includes("2030-01-01 UTC"));
        now = "2030-01-01T23:59:59.000Z";
        el("play").click(); frames(1);
        assert(JSON.stringify({ obstacles: win.testGame.obstacles, coins: win.testGame.coins }) === opening, "Daily retry rerolled the opening");
        win.testGame.failure = "rock"; frames(1);
        now = "2030-01-02T00:00:01.000Z";
        el("play").click(); frames(1);
        assert(el("daily-date").textContent.includes("2030-01-02 UTC"));
        frames(60); win.testGame.failure = "rock"; frames(1);
        assert(JSON.parse(localStorage.getItem(PROGRESS_KEY)).dailyBests["2030-01-02"] > 0);
      } finally { win.Date = OriginalDate; }
    });
    await test("Boat shop previews, spends once, locks during play and persists selection", async () => {
      el("studio").open = true;
      await wait();
      const mint = doc.querySelector('[data-skin="mint"]');
      assert(doc.querySelectorAll(".skin-preview").length === 3);
      assert(mint.textContent.includes("25 coins") && !mint.disabled);
      const bank = Number(el("coin-bank").textContent);
      mint.click();
      assert(Number(el("coin-bank").textContent) === bank - 25 && mint.textContent === "Selected");
      assert(el("shop-feedback").textContent.includes("selected"));
      const paper = doc.querySelector('[data-skin="paper"]');
      paper.click(); mint.click();
      assert(Number(el("coin-bank").textContent) === bank - 25, "Reselection charged again");
      const rect = el("game").getBoundingClientRect();
      const worldWidth = Math.max(minimumViewWidth(win.testGame.mode), Math.min(1100, rect.width / rect.height * RULES.height));
      const hull = el("game").getContext("2d").getImageData(Math.floor(RULES.boatX / worldWidth * el("game").width), Math.floor((waterY(win.testGame.lift) + 6) / RULES.height * el("game").height), 1, 1).data;
      assert(Math.abs(hull[0] - 119) < 3 && Math.abs(hull[1] - 205) < 3 && Math.abs(hull[2] - 179) < 3, "Selected skin was not rendered on boat");
      doc.querySelector("#studio summary").dispatchEvent(new win.KeyboardEvent("keydown", { code: "Space", bubbles: true }));
      assert(!el("mode").disabled || el("course").value === "daily");
      assert(!el("course").disabled, "Studio keyboard interaction started gameplay");
      el("play").click();
      frames(1);
      assert(doc.querySelectorAll(".skin-card button:disabled").length === 3);
      const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      assert(saved.selected === "mint" && saved.owned.includes("mint"));
      win.testGame.failure = "rock";
      frames(1);
      const reload = new Promise(resolve => iframe.onload = resolve);
      iframe.srcdoc = source.replace("<head>", `<head>${scheduler}`);
      await reload;
      win = iframe.contentWindow;
      doc = iframe.contentDocument;
      await wait();
      assert(doc.querySelector('[data-skin="mint"]').textContent === "Selected");
      assert(Number(el("coin-bank").textContent) === bank - 25);
    });
    await test("Perfect feedback and all scenery themes render without changing hazard interpretation", () => {
      el("play").click(); frames(1);
      const game = win.testGame;
      const hazards = JSON.stringify(game.obstacles);
      const skies = [];
      for (const [seconds, label] of [[0, "Garden canal"], [60, "Rainy streets"], [95, "Moonlit water"]]) {
        game.elapsed = seconds;
        frames(1);
        assert(el("scenery").textContent === label);
        assert(game.failure === null);
        skies.push(Array.from(el("game").getContext("2d").getImageData(5, 5, 1, 1).data).join(","));
      }
      assert(new Set(skies).size === 3, "Scenery labels changed without actual color changes");
      // Changing scenery does not rewrite existing geometry; only new spawns get harder.
      assert(JSON.stringify(game.obstacles) === hazards);
      game.lift = (RULES.lowWater - (340 - RULES.draft - 25)) / RULES.travel;
      game.obstacles = [{ type: "rock", x: game.distance + RULES.boatX - RULES.boatHalfWidth - 5, width: 8, edge: 340, passed: false }];
      key("keydown", "Space"); frames(2); key("keyup", "Space");
      assert(el("combo").textContent.includes("Perfect!") && el("combo").textContent.includes("+5 points"));
      assert(game.bonus === 5 && Number(el("score").textContent) === game.score);
      game.failure = "rock"; frames(1);
      assert(win.testErrors.length === 0, win.testErrors.join("; "));
    });
    await test("Audio failures report explicitly and muted sound stays lazy", async () => {
      let errors = 0;
      let creates = 0;
      const sound = new TideSound({ muted: true, createContext: () => { creates++; throw new Error("Audio blocked"); }, onError: () => errors++ });
      await sound.unlock();
      assert(creates === 0);
      sound.setMuted(false);
      await sound.unlock();
      assert(creates === 1 && errors === 1 && sound.failed);
      await sound.unlock();
      assert(errors === 1);
    });
    await test("Real Web Audio renders audible-range effects and mute cancels scheduled notes", async () => {
      const OfflineAudio = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      assert(OfflineAudio, "OfflineAudioContext unavailable");
      for (const muted of [false, true]) {
        const context = new OfflineAudio(1, 44100, 44100);
        const proxy = new Proxy(context, {
          get(target, key) {
            if (key === "state") return "running";
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        const sound = new TideSound({ createContext: () => proxy });
        await sound.unlock();
        for (const name of ["start", "coin", "rise", "fall", "finish", "perfect"]) sound.play(name);
        if (muted) sound.setMuted(true);
        const rendered = await context.startRendering();
        const peak = rendered.getChannelData(0).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
        assert(muted ? peak === 0 : peak > .01 && peak < 1, `Unexpected ${muted ? "muted" : "audible"} peak ${peak}`);
      }
    });
  } finally {
    iframe.remove();
    for (const [key, value] of originals) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }
  return { passed, total: results.length, results };
}
