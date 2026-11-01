export const SKINS = Object.freeze({
  paper: Object.freeze({ name: "Sunrise paper", price: 0, hull: "#ebad70", sail: "#fffbed", fold: "#e8d9ba" }),
  mint: Object.freeze({ name: "Mint explorer", price: 25, hull: "#77cdb3", sail: "#f0fff8", fold: "#b1dcca" }),
  berry: Object.freeze({ name: "Berry voyager", price: 50, hull: "#c780a6", sail: "#fff2fa", fold: "#e5bed4" }),
  pearl: Object.freeze({ name: "Pearl drifter", mastery: "collector", hull: "#acc7dc", sail: "#ffffff", fold: "#d3dfee" }),
  solar: Object.freeze({ name: "Solar sailor", mastery: "precision", hull: "#e5bf51", sail: "#fff8d5", fold: "#edd88e" }),
});
export const MISSIONS = Object.freeze([
  Object.freeze({ id: "coins10", label: "Collect 10 coins in one run", metric: "collected", target: 10, reward: 15 }),
  Object.freeze({ id: "passes5", label: "Clear 5 obstacles in one run", metric: "passed", target: 5, reward: 10 }),
  Object.freeze({ id: "perfects3", label: "Make 3 perfect passes in one run", metric: "perfects", target: 3, reward: 20 }),
]);
export const PROGRESS_KEY = "tiny-tide-progress-v1";
export const MASTERY = Object.freeze([
  Object.freeze({ id: "collector", label: "Treasure keeper", metric: "collected", target: 50, detail: "coins collected", skin: "pearl" }),
  Object.freeze({ id: "navigator", label: "Canal navigator", metric: "passed", target: 25, detail: "obstacles cleared" }),
  Object.freeze({ id: "precision", label: "Perfect flow", metric: "perfects", target: 10, detail: "perfect passes", skin: "solar" }),
]);
const METRICS = ["collected", "passed", "perfects"];
const counts = () => ({ collected: 0, passed: 0, perfects: 0 });
const isDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validCounts = value => isObject(value) && METRICS.every(metric => isCount(value[metric]));
const validDailyScores = value => isObject(value)
  && Object.entries(value).every(([date, score]) => isDate(date) && isCount(score));
const newRunId = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), word => word.toString(16).padStart(8, "0")).join("-");

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const fresh = coins => ({
  version: 6, coins, owned: ["paper"], selected: "paper", completed: [], dailyBests: {}, legacyDailyBests: {}, archivedBoostDailyBests: {}, archivedT10DailyBests: {}, archivedT11DailyBests: {},
  totals: counts(), dailyGoals: {}, runs: {},
});

function decode(raw) {
  const data = JSON.parse(raw);
  if (!data || ![1, 2, 3, 4, 5, 6].includes(data.version) || !isCount(data.coins)
    || !Array.isArray(data.owned) || !data.owned.includes("paper") || data.owned.some(id => !Object.hasOwn(SKINS, id))
    || !data.owned.includes(data.selected) || !Array.isArray(data.completed)
    || data.completed.some(id => !MISSIONS.some(mission => mission.id === id))
    || !validDailyScores(data.dailyBests)) {
    throw new Error("Saved progress is invalid. Existing data has not been overwritten.");
  }
  if (data.version >= 2 && (!validCounts(data.totals) || !isObject(data.dailyGoals) || !isObject(data.runs)
    || Object.entries(data.dailyGoals).some(([date, goal]) => !isDate(date) || !validCounts(goal)
      || !Array.isArray(goal.claimed) || goal.claimed.some(id => !METRICS.includes(id)))
    || Object.entries(data.runs).some(([id, run]) => !/^[a-zA-Z0-9-]{1,80}$/.test(id) || !isDate(run.date) || !validCounts(run) || (run.giftCoins !== undefined && !isCount(run.giftCoins))))) {
    throw new Error("Saved goals or mastery are invalid. Existing data has not been overwritten.");
  }
  if (data.version < 4) {
    // Boosted runs use a new score ruleset; retain old daily records without comparing them.
    const legacyDailyBests = data.version === 3 ? data.legacyDailyBests : { ...(data.legacyDailyBests || {}), ...data.dailyBests };
    if (!validDailyScores(legacyDailyBests)) throw new Error("Saved prior-rule records are invalid. Existing data has not been overwritten.");
    return {
      ...fresh(data.coins),
      ...data,
      version: 6,
      dailyBests: {},
      legacyDailyBests,
      archivedBoostDailyBests: data.version === 3 ? data.dailyBests : {},
      archivedT10DailyBests: {},
      totals: data.version === 1 ? counts() : data.totals,
      dailyGoals: data.version === 1 ? {} : data.dailyGoals,
      runs: data.version === 1 ? {} : data.runs,
    };
  }
  if (!validDailyScores(data.legacyDailyBests) || !validDailyScores(data.archivedBoostDailyBests)) {
    throw new Error("Saved prior-rule records are invalid. Existing data has not been overwritten.");
  }
  if (data.version === 4) return { ...data, version: 6, dailyBests: {}, archivedT10DailyBests: data.dailyBests, archivedT11DailyBests: {} };
  if (!validDailyScores(data.archivedT10DailyBests)) throw new Error("Saved T10 records are invalid. Existing data has not been overwritten.");
  if (data.version === 5) return { ...data, version: 6, dailyBests: {}, archivedT11DailyBests: data.dailyBests };
  if (!validDailyScores(data.archivedT11DailyBests)) throw new Error("Saved T11 records are invalid. Existing data has not been overwritten.");
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
        if (SKINS[id].mastery) throw new Error("Earn this boat through its mastery milestone; coins are not required.");
        if (next.coins < SKINS[id].price) throw new Error("Not enough coins for this boat yet.");
        next.coins -= SKINS[id].price;
        next.owned.push(id);
      }
      next.selected = id;
    }, true);
  }

  beginRun(date, id = newRunId()) {
    if (!isDate(date) || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new RangeError("Invalid run date or ID");
    this.change(next => {
      if (Object.hasOwn(next.runs, id)) throw new Error("Run already started.");
      // Old receipts are discarded, not recreated. Replaying a discarded ID is rejected.
      for (const old of Object.keys(next.runs).slice(0, -31)) delete next.runs[old];
      next.runs[id] = { date, ...counts() };
    });
    return id;
  }

  recordRun(run, id) {
    if (!validCounts(run) || (run.giftCoins !== undefined && !isCount(run.giftCoins))) throw new RangeError("Invalid run counters");
    return this.change(next => {
      if (!Object.hasOwn(next.runs, id)) throw new Error("This run receipt is no longer available. Reload to start a new run and save progress.");
      const previous = next.runs[id];
      const giftCoins = run.giftCoins || 0;
      const previousGiftCoins = previous.giftCoins || 0;
      if (giftCoins < previousGiftCoins) throw new Error("Gift coin counters cannot go backwards.");
      const giftDelta = giftCoins - previousGiftCoins;
      previous.giftCoins = giftCoins;
      if (METRICS.some(metric => run[metric] < previous[metric])) throw new Error("Run counters cannot go backwards.");
      const delta = Object.fromEntries(METRICS.map(metric => [metric, run[metric] - previous[metric]]));
      const date = previous.date;
      const daily = next.dailyGoals[date] || { ...counts(), claimed: [] };
      const earned = MISSIONS.filter(mission => !next.completed.includes(mission.id) && run[mission.metric] >= mission.target);
      next.completed.push(...earned.map(mission => mission.id));
      const goals = dailyMissions(date);
      for (const metric of METRICS) {
        next.totals[metric] = Math.min(Number.MAX_SAFE_INTEGER, next.totals[metric] + delta[metric]);
        daily[metric] = Math.min(goals.find(goal => goal.metric === metric).target, daily[metric] + delta[metric]);
        previous[metric] = run[metric];
      }
      for (const goal of goals) {
        if (!daily.claimed.includes(goal.id) && daily[goal.metric] >= goal.target) {
          daily.claimed.push(goal.id);
          earned.push({ ...goal, label: `Daily: ${goal.label}` });
        }
      }
      next.dailyGoals[date] = daily;
      for (const badge of MASTERY) {
        if (badge.skin && next.totals[badge.metric] >= badge.target && !next.owned.includes(badge.skin)) {
          next.owned.push(badge.skin);
          earned.push({ label: `${badge.label}: ${SKINS[badge.skin].name} unlocked`, reward: 0 });
        }
      }
      next.coins = Math.min(Number.MAX_SAFE_INTEGER, next.coins + delta.collected + giftDelta + earned.reduce((sum, mission) => sum + mission.reward, 0));
      return earned;
    });
  }

  recordDaily(date, score) {
    if (!isDate(date) || !isCount(score)) throw new RangeError("Invalid daily record");
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
  if (!isDate(date)) throw new RangeError("Invalid challenge date");
  let seed = 2166136261;
  for (const char of `tiny-tide-daily-v1:${date}`) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function dailyMissions(date) {
  if (!isDate(date)) throw new RangeError("Invalid mission date");
  const day = ((Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) % 6) + 6) % 6;
  return [
    { id: "collected", metric: "collected", target: [6, 9, 12][day % 3], reward: 5, label: "Collect coins" },
    { id: "passed", metric: "passed", target: [2, 3, 4][(day + 1) % 3], reward: 7, label: "Clear obstacles" },
    { id: "perfects", metric: "perfects", target: [1, 2][day % 2], reward: 9, label: "Make perfect passes" },
  ];
}

export function bestComparison(score, previousBest) {
  if (!isCount(score) || !isCount(previousBest)) throw new RangeError("Invalid comparison");
  if (previousBest === 0) return score > 0 ? `First score: ${score} points. Your starting benchmark.` : "First attempt: no points yet. Try again when you like.";
  if (score > previousBest) return `New best! +${score - previousBest} points over your pre-run best of ${previousBest}.`;
  if (score === previousBest) return `Matched your pre-run best of ${previousBest} points.`;
  return `${previousBest - score} points below your pre-run best of ${previousBest}.`;
}
