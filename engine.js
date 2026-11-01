export const RULES = Object.freeze({
  height: 600, boatX: 122, boatHalfWidth: 26, boatHeight: 40, draft: 9,
  lowWater: 465, travel: 220, tideRate: 0.68, boostFactor: 1.6, maxBoostFactor: 2.2,
  progressionSeconds: 90,
});
export const MODES = Object.freeze({
  easy: Object.freeze({ label: "Easy", startSpeed: 105, maxSpeed: 165 }),
  medium: Object.freeze({ label: "Medium", startSpeed: 145, maxSpeed: 220 }),
  fast: Object.freeze({ label: "Fast", startSpeed: 190, maxSpeed: 275 }),
});
export const GIFTS = Object.freeze({
  booster: { label: "Booster pack", icon: "🚀", color: "#e59335", duration: 6 },
  autopilot: { label: "Autopilot", icon: "🧭", color: "#b095dc", duration: 8 },
  coins: { label: "+10 coins", icon: "🪙", color: "#e1bb47", duration: 0 },
});

export function minimumViewWidth(mode) {
  return Math.max(560, Math.ceil(MODES[mode].maxSpeed * RULES.maxBoostFactor * (1 / RULES.tideRate + .5) + RULES.boatX + RULES.boatHalfWidth));
}

export function waterY(lift) {
  return RULES.lowWater - lift * RULES.travel;
}

export function sceneryState(elapsed) {
  const phase = Math.max(0, Math.min(2, (elapsed - 25) / 35));
  const from = Math.floor(phase);
  const t = phase - from;
  return { from, to: Math.min(2, from + 1), blend: t * t * (3 - 2 * t) };
}

export class TideGame {
  constructor(random = Math.random, mode = "medium") {
    this.random = random;
    this.reset(mode);
  }

  reset(mode = this.mode) {
    if (!Object.hasOwn(MODES, mode)) throw new RangeError(`Unknown mode: ${mode}`);
    this.mode = mode;
    this.difficulty = MODES[mode];
    this.distance = 0;
    this.elapsed = 0;
    this.accumulator = 0;
    this.lift = 0.34;
    this.baseSpeed = this.difficulty.startSpeed;
    this.speed = this.difficulty.startSpeed;
    this.obstacles = [];
    this.coins = [];
    this.collected = 0;
    this.pickups = [];
    this.passEvents = [];
    this.combo = 0;
    this.perfects = 0;
    this.bonus = 0;
    this.passed = 0;
    this.failure = null;
    this.spawnCount = 0;
    this.lastType = "bridge";
    this.boostAmount = 0;
    this.manualBoost = 0;
    this.packBoost = 0;
    this.superAmount = 0;
    this.gifts = [];
    this.giftEvents = [];
    this.giftCoins = 0;
    this.effect = null;
    this.handoff = 0;
    this.giftFeedback = null;
    this.spawn(720);
  }

  spawn(x) {
    const challenge = this.courseProgression;
    const type = this.spawnCount < 2
      ? (this.lastType === "bridge" ? "rock" : "bridge")
      : (this.random() < .4 - .32 * challenge ? this.lastType : this.lastType === "rock" ? "bridge" : "rock");
    const obstacle = {
      type, x, width: type === "rock" ? 62 + 38 * challenge : 94 + 46 * challenge,
      edge: type === "rock" ? 336 + this.random() * 26 - 46 * challenge : 310 + this.random() * 22 + 60 * challenge,
      challenge,
      passed: false,
    };
    this.lastType = type;
    this.spawnCount++;
    this.obstacles.push(obstacle);
    // Coins trace the safe approach, never lure the boat into an obstacle.
    for (const offset of [90, 35, -20]) {
      this.coins.push({ x: x - offset, y: waterY(type === "rock" ? 1 : 0) - 18 });
    }
    if (this.spawnCount % 4 === 2) {
      const effect = ["booster", "booster", "autopilot", "coins"][Math.floor(this.random() * 4)];
      this.gifts.push({ x: x - 70, y: waterY(type === "rock" ? 1 : 0) - 18, effect });
    }
    return obstacle;
  }

  update(dt, holding, boosting = false) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be finite and non-negative");
    this.pickups = [];
    this.passEvents = [];
    this.giftEvents = [];
    if (this.failure) return;
    // Fixed ticks keep seeded courses identical across display frame rates.
    const step = 1 / 120;
    this.accumulator += Math.min(dt, .1);
    while (this.accumulator + 1e-10 >= step && !this.failure) {
      this.accumulator = Math.max(0, this.accumulator - step);
      this.elapsed += step;
      if (this.giftFeedback) {
        this.giftFeedback.remaining -= step;
        if (this.giftFeedback.remaining <= 0) this.giftFeedback = null;
      }
      if (this.effect) {
        this.effect.remaining = Math.max(0, this.effect.remaining - step);
        // Finish the current passage before giving the tide back to the player.
        if (this.effect.remaining === 0 && (this.effect.type !== "autopilot" || !this.effect.exitObstacle || this.effect.exitObstacle.passed)) {
          if (this.effect.type === "autopilot") this.handoff = 2;
          this.effect = null;
        }
      }
      const auto = this.effect?.type === "autopilot";
      if (auto && this.effect.remaining > 0) this.effect.exitObstacle = this.next;
      const tideHolding = auto ? this.next?.type === "rock" : holding;
      this.lift = Math.max(0, Math.min(1, this.lift + (tideHolding ? 1 : -1) * RULES.tideRate * step));
      this.baseSpeed = this.difficulty.startSpeed + (this.difficulty.maxSpeed - this.difficulty.startSpeed) * this.progression;
      this.manualBoost = Math.max(0, Math.min(1, this.manualBoost + (boosting ? 4 : -6) * step));
      this.packBoost = Math.max(0, Math.min(1, this.packBoost + (this.effect?.type === "booster" ? 4 : -6) * step));
      this.boostAmount = Math.max(this.manualBoost, this.packBoost);
      this.superAmount = Math.min(this.manualBoost, this.packBoost);
      this.handoff = Math.max(0, this.handoff - step);
      this.speed = this.baseSpeed * (this.handoff > 0 ? .6 : 1 + (RULES.boostFactor - 1) * (this.manualBoost + this.packBoost));
      this.distance += this.speed * step;
      const left = this.distance + RULES.boatX - RULES.boatHalfWidth;
      const right = this.distance + RULES.boatX + RULES.boatHalfWidth;
      const y = waterY(this.lift);
      for (const obstacle of this.obstacles) {
        if (right > obstacle.x && left < obstacle.x + obstacle.width) {
          obstacle.lastClearance = obstacle.type === "rock" ? obstacle.edge - y - RULES.draft : y - RULES.boatHeight - obstacle.edge;
          if (obstacle.type === "rock" ? y + RULES.draft >= obstacle.edge : y - RULES.boatHeight <= obstacle.edge) {
            this.failure = obstacle.type;
            break;
          }
        }
        if (!obstacle.passed && left >= obstacle.x + obstacle.width) {
          obstacle.passed = true;
          this.passed++;
          const perfect = obstacle.lastClearance >= 12 && obstacle.lastClearance <= 38;
          this.combo = perfect ? this.combo + 1 : 0;
          if (perfect) this.perfects++;
          const bonus = perfect ? 5 * Math.min(this.combo, 5) : 0;
          this.bonus += bonus;
          this.passEvents.push({ perfect, combo: this.combo, bonus });
        }
      }
      if (!this.failure) {
        for (const coin of this.coins) {
          if (!coin.collected && Math.abs(coin.x - (this.distance + RULES.boatX)) < 30 && Math.abs(coin.y - (y - 18)) < 28) {
            coin.collected = true;
            this.collected++;
            this.pickups.push({ x: coin.x, y: coin.y });
          }
        }
        for (const gift of this.gifts) {
          if (!gift.collected && Math.abs(gift.x - (this.distance + RULES.boatX)) < 30 && Math.abs(gift.y - (y - 18)) < 28) {
            gift.collected = true;
            this.giftEvents.push({ ...gift });
            this.giftFeedback = { type: gift.effect, remaining: 2 };
            if (gift.effect === "coins") this.giftCoins += 10;
            else {
              this.effect = { type: gift.effect, remaining: GIFTS[gift.effect].duration, exitObstacle: null };
              this.handoff = 0;
            }
          }
        }
      }
      if (this.failure) {
        this.effect = null;
        this.handoff = 0;
        this.boostAmount = 0;
        this.manualBoost = 0;
        this.packBoost = 0;
        this.superAmount = 0;
        this.giftFeedback = null;
      }
      this.gifts = this.gifts.filter(gift => !gift.collected && gift.x > this.distance - 50);
      this.coins = this.coins.filter(coin => !coin.collected && coin.x > this.distance - 50);
      this.obstacles = this.obstacles.filter(o => o.x + o.width > this.distance - 100);
      const last = this.obstacles.at(-1);
      if (!last || last.x < this.distance + 1800) {
        this.spawn(last ? last.x + last.width + this.obstacleGap + this.random() * 100 : this.distance + 720);
      }
    }
  }

  get score() { return Math.floor(this.distance / 10) + this.bonus; }
  get progression() {
    const t = Math.min(1, this.elapsed / RULES.progressionSeconds);
    return t * t * (3 - 2 * t);
  }
  get courseProgression() {
    const t = Math.min(1, this.spawnCount / 24);
    return t * t * (3 - 2 * t);
  }
  get obstacleGap() {
    // Budget at the maximum boosted speed, including overlap, coin approach,
    // a full-height transition, and reaction time.
    return 2 * RULES.boatHalfWidth + 90
      + this.difficulty.maxSpeed * RULES.maxBoostFactor * (1 / RULES.tideRate + .25 + .7 * (1 - this.courseProgression));
  }
  get next() { return this.obstacles.find(o => !o.passed); }
}
