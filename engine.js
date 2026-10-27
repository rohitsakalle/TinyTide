export const RULES = Object.freeze({
  height: 600, boatX: 122, boatHalfWidth: 26, boatHeight: 40, draft: 9,
  lowWater: 465, travel: 220, tideRate: 0.68,
  progressionSeconds: 90,
});
export const MODES = Object.freeze({
  easy: Object.freeze({ label: "Easy", startSpeed: 105, maxSpeed: 165 }),
  medium: Object.freeze({ label: "Medium", startSpeed: 145, maxSpeed: 220 }),
  fast: Object.freeze({ label: "Fast", startSpeed: 190, maxSpeed: 275 }),
});

export function minimumViewWidth(mode) {
  return Math.max(560, Math.ceil(MODES[mode].maxSpeed * (1 / RULES.tideRate + .5) + RULES.boatX + RULES.boatHalfWidth));
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
    this.spawn(720);
  }

  spawn(x) {
    const type = this.spawnCount < 2
      ? (this.lastType === "bridge" ? "rock" : "bridge")
      : (this.random() < .4 - .32 * this.progression ? this.lastType : this.lastType === "rock" ? "bridge" : "rock");
    const challenge = this.progression;
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
    return obstacle;
  }

  update(dt, holding) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("dt must be finite and non-negative");
    this.pickups = [];
    this.passEvents = [];
    if (this.failure) return;
    // Fixed ticks keep seeded courses identical across display frame rates.
    const step = 1 / 120;
    this.accumulator += Math.min(dt, .1);
    while (this.accumulator + 1e-10 >= step && !this.failure) {
      this.accumulator = Math.max(0, this.accumulator - step);
      this.elapsed += step;
      this.lift = Math.max(0, Math.min(1, this.lift + (holding ? 1 : -1) * RULES.tideRate * step));
      this.speed = this.difficulty.startSpeed + (this.difficulty.maxSpeed - this.difficulty.startSpeed) * this.progression;
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
      }
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
  get obstacleGap() {
    // Budget at the mode's future speed, including boat overlap, the first coin,
    // a full-height transition, and reaction time even at maximum difficulty.
    return 2 * RULES.boatHalfWidth + 90
      + this.difficulty.maxSpeed * (1 / RULES.tideRate + .25 + .7 * (1 - this.progression));
  }
  get next() { return this.obstacles.find(o => !o.passed); }
}
