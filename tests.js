import { TideGame, RULES, MODES, minimumViewWidth, waterY } from "./engine.js";
import { TideSound } from "./sound.js";

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
    const lead = 560 - RULES.boatX - RULES.boatHalfWidth;
    assert(lead / RULES.maxSpeed > 1 / RULES.tideRate + .5);
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
        game.obstacles = [];
        game.spawn(game.distance + 720);
      }
      let previous;
      for (let frame = 0; frame < 60 * 100; frame++) {
        const obstacle = game.next;
        if (obstacle && obstacle !== previous) {
          if (previous) {
            const gap = obstacle.x - previous.x - previous.width - 2 * RULES.boatHalfWidth;
            assert(gap / RULES.maxSpeed > 1 / RULES.tideRate, `Insufficient gap, seed ${seed}`);
          }
          previous = obstacle;
        }
        game.update(1 / 60, obstacle?.type === "rock");
        assert(game.failure === null, `seed ${seed}, frame ${frame}, obstacle ${obstacle?.type}`);
      }
      assert(game.passed >= 20, `Too few obstacles, seed ${seed}`);
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
    <\/script>`;
  iframe.srcdoc = source.replace("<head>", `<head>${scheduler}`);
  const loaded = new Promise((resolve, reject) => {
    iframe.onload = resolve;
    iframe.onerror = () => reject(new Error("Integration frame failed to load"));
  });
  const storageKeys = ["tiny-tide-best", "tiny-tide-best-easy", "tiny-tide-best-medium", "tiny-tide-best-fast", "tiny-tide-coins", "tiny-tide-muted"];
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
      assert(el("best").textContent === "37 m");
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
      frames(100);
      assert(!el("overlay").hidden && el("score").textContent === score);
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
      key("keyup", "Space");
      assert(win.testErrors.length === 0, win.testErrors.join("; "));
    });
    await test("Collect coins, persist immediately and keep balance across reload", async () => {
      key("keydown", "Space");
      frames(270);
      key("keyup", "Space");
      assert(el("run-coins").textContent === "3", "Expected opening trail's three coins");
      assert(el("coin-bank").textContent === "13");
      assert(localStorage.getItem("tiny-tide-coins") === "13");
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
        assert(el("best").textContent === (mode === "medium" ? `${localStorage.getItem("tiny-tide-best-medium") || 37} m` : "0 m"));
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
        assert(saved > 0 && el("best").textContent === `${saved} m`);
      }
      assert(Number(localStorage.getItem("tiny-tide-best")) === Number(localStorage.getItem("tiny-tide-best-medium")));
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
        for (const name of ["start", "coin", "rise", "fall", "finish"]) sound.play(name);
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
