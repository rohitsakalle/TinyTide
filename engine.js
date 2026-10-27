export const RULES = Object.freeze({
  height: 600, boatX: 122, boatHalfWidth: 26, boatHeight: 40, draft: 9,
  lowWater: 465, travel: 220, tideRate: 0.68,
  startSpeed: 145, maxSpeed: 195, minGapSeconds: 2.15,
});
export const MODES = Object.freeze({
  easy: Object.freeze({ label: "Easy", startSpeed: 105, maxSpeed: 145 }),
  medium: Object.freeze({ label: "Medium", startSpeed: 145, maxSpeed: 195 }),
  fast: Object.freeze({ label: "Fast", startSpeed: 190, maxSpeed: 245 }),
});

export function minimumViewWidth(mode) {
  return Math.max(560, Math.ceil(MODES[mode].maxSpeed * (1 / RULES.tideRate + .5) + RULES.boatX + RULES.boatHalfWidth));
}

export function waterY(lift) {
  return RULES.lowWater - lift * RULES.travel;
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
    this.lift = 0.34;
    this.speed = this.difficulty.startSpeed;
    this.obstacles = [];
    this.coins = [];
    this.collected = 0;
    this.pickups = [];
    this.passed = 0;
    this.failure = null;
    this.spawnCount = 0;
    this.lastType = "bridge";
    this.spawn(720);
  }

  spawn(x) {
    const type = this.spawnCount < 2
      ? (this.lastType === "bridge" ? "rock" : "bridge")
      : (this.random() < 0.24 ? this.lastType : this.lastType === "rock" ? "bridge" : "rock");
    const obstacle = {
      type, x, width: type === "rock" ? 62 : 94,
      edge: type === "rock" ? 336 + this.random() * 26 : 310 + this.random() * 22,
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
    if (this.failure) return;
    // Substeps prevent tunnelling on slow displays; stalls don't jump the boat.
    for (let remaining = Math.min(dt, 0.1); remaining > 1e-10 && !this.failure;) {
      const step = Math.min(remaining, 1 / 120);
      remaining -= step;
      this.lift = Math.max(0, Math.min(1, this.lift + (holding ? 1 : -1) * RULES.tideRate * step));
      this.speed = Math.min(this.difficulty.maxSpeed, this.difficulty.startSpeed + this.distance / 220);
      this.distance += this.speed * step;
      const left = this.distance + RULES.boatX - RULES.boatHalfWidth;
      const right = this.distance + RULES.boatX + RULES.boatHalfWidth;
      const y = waterY(this.lift);
      for (const obstacle of this.obstacles) {
        if (right > obstacle.x && left < obstacle.x + obstacle.width) {
          if (obstacle.type === "rock" ? y + RULES.draft >= obstacle.edge : y - RULES.boatHeight <= obstacle.edge) {
            this.failure = obstacle.type;
            break;
          }
        }
        if (!obstacle.passed && left >= obstacle.x + obstacle.width) {
          obstacle.passed = true;
          this.passed++;
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
        // Maximum future speed guarantees room for a full tide transition.
        this.spawn(last ? last.x + last.width + this.difficulty.maxSpeed * RULES.minGapSeconds + this.random() * 100 : this.distance + 720);
      }
    }
  }

  get score() { return Math.floor(this.distance / 10); }
  get next() { return this.obstacles.find(o => !o.passed); }
}
