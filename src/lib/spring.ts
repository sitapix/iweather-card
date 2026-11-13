import { SECOND } from './time.ts';

// A value pulled toward its target by a spring of mass 1, stepped a millisecond at a time, as
// springEasing works one out. It is at rest once within a hundredth of its target and moving
// slower than a tenth a second.
const REST_DISTANCE = 0.01,
  REST_SPEED = 0.1;
export interface SpringSettings {
  stiffness: number;
  damping: number;
}
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  readonly settings: SpringSettings;
  constructor(value: number, settings: SpringSettings) {
    this.value = value;
    this.target = value;
    this.settings = settings;
  }
  // Moves it on by `ms`.
  step(ms: number) {
    const { stiffness, damping } = this.settings;
    for (let left = ms; left > 0; left--) {
      const each = Math.min(1, left) / SECOND;
      this.velocity += (stiffness * (this.target - this.value) - damping * this.velocity) * each;
      this.value += this.velocity * each;
    }
  }
  // Puts it at `value`, at rest.
  snap(value = this.target) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }
  get resting() {
    return Math.abs(this.target - this.value) < REST_DISTANCE && Math.abs(this.velocity) < REST_SPEED;
  }
  // The farthest it can still swing from its target, left to itself: its distance and speed taken
  // together as the reach of its energy, which damping only ever takes away.
  get swing(): number {
    return Math.hypot(this.value - this.target, this.velocity / Math.sqrt(this.settings.stiffness));
  }
}
