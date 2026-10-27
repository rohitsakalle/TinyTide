export const SKINS = Object.freeze({
  paper: Object.freeze({ name: "Sunrise paper", price: 0, hull: "#ebad70", sail: "#fffbed", fold: "#e8d9ba" }),
  mint: Object.freeze({ name: "Mint explorer", price: 25, hull: "#77cdb3", sail: "#f0fff8", fold: "#b1dcca" }),
  berry: Object.freeze({ name: "Berry voyager", price: 50, hull: "#c780a6", sail: "#fff2fa", fold: "#e5bed4" }),
});
export const MISSIONS = Object.freeze([
  Object.freeze({ id: "coins10", label: "Collect 10 coins in one run", metric: "collected", target: 10, reward: 15 }),
  Object.freeze({ id: "passes5", label: "Clear 5 obstacles in one run", metric: "passed", target: 5, reward: 10 }),
  Object.freeze({ id: "perfects3", label: "Make 3 perfect passes in one run", metric: "perfects", target: 3, reward: 20 }),
]);
export const PROGRESS_KEY = "tiny-tide-progress-v1";

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const fresh = coins => ({ version: 1, coins, owned: ["paper"], selected: "paper", completed: [], dailyBests: {} });

function decode(raw) {
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !isCount(data.coins)
    || !Array.isArray(data.owned) || !data.owned.includes("paper") || data.owned.some(id => !Object.hasOwn(SKINS, id))
    || !data.owned.includes(data.selected) || !Array.isArray(data.completed)
    || data.completed.some(id => !MISSIONS.some(mission => mission.id === id))
    || !data.dailyBests || Array.isArray(data.dailyBests) || typeof data.dailyBests !== "object"
    || Object.entries(data.dailyBests).some(([date, score]) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isCount(score))) {
    throw new Error("Saved progress is invalid. Existing data has not been overwritten.");
  }
  return data;
}

export class ProgressStore {
  constructor(storage, onError = console.warn) {
    this.storage = storage;
    this.onError = onError;
    this.persistent = true;
    this.data = fresh(0);
    try {
      const raw = storage.getItem(PROGRESS_KEY);
      if (raw !== null) this.data = decode(raw);
      else {
        const coins = Number(storage.getItem("tiny-tide-coins") || 0);
        if (!isCount(coins)) throw new Error("Saved coin balance is invalid.");
        this.data = fresh(coins);
      }
    } catch (error) { this.fail(error); }
  }

  fail(error) {
    this.persistent = false;
    this.onError(error);
  }

  change(update, purchase = false) {
    if (purchase && !this.persistent) throw new Error("Boat purchases need working local storage. Your coins have not been spent.");
    if (this.persistent) {
      try {
        const raw = this.storage.getItem(PROGRESS_KEY);
        if (raw !== null) this.data = decode(raw);
      } catch (error) {
        this.fail(error);
        if (purchase) throw error;
      }
    }
    const next = structuredClone(this.data);
    const result = update(next);
    if (this.persistent) {
      try { this.storage.setItem(PROGRESS_KEY, JSON.stringify(next)); }
      catch (error) {
        this.fail(error);
        // A failed purchase must leave both ownership and the bank unchanged.
        if (purchase) throw new Error("Could not save your boat. Your coins have not been spent.", { cause: error });
      }
    }
    this.data = next;
    return result;
  }

  chooseSkin(id) {
    if (!Object.hasOwn(SKINS, id)) throw new RangeError("Unknown boat skin");
    return this.change(next => {
      if (!next.owned.includes(id)) {
        if (next.coins < SKINS[id].price) throw new Error("Not enough coins for this boat yet.");
        next.coins -= SKINS[id].price;
        next.owned.push(id);
      }
      next.selected = id;
    }, true);
  }

  recordRun(run, pickupCount) {
    if (!isCount(pickupCount)) throw new RangeError("Invalid pickup count");
    return this.change(next => {
      const earned = MISSIONS.filter(mission => !next.completed.includes(mission.id) && run[mission.metric] >= mission.target);
      next.coins = Math.min(Number.MAX_SAFE_INTEGER, next.coins + pickupCount + earned.reduce((sum, mission) => sum + mission.reward, 0));
      next.completed.push(...earned.map(mission => mission.id));
      return earned;
    });
  }

  recordDaily(date, score) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isCount(score)) throw new RangeError("Invalid daily record");
    this.change(next => {
      next.dailyBests[date] = Math.max(next.dailyBests[date] || 0, score);
      for (const old of Object.keys(next.dailyBests).sort().slice(0, -14)) delete next.dailyBests[old];
    });
  }
}

export function utcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function dailyRandom(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError("Invalid challenge date");
  let seed = 2166136261;
  for (const char of `tiny-tide-daily-v1:${date}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
