// A glass switch: a thumb under the pressed one of a group's options. A press held still does
// nothing until it is let go: then the thumb swells into a clear lens, slides over to the option
// pressed and settles. Dragged instead, it swells as the drag starts and follows the pointer across
// the options, and letting go springs it to the nearest one. Choosing one may draw the group again:
// `attach` takes the new group, and the thumb carries on from where it was.
// Where the styles set `--switch: flat` on the group, the thumb is plain: a press doesn't swell it
// and can't drag it, and it stands under the chosen option, going straight to another once that is
// chosen, with nothing between.
import { child, onHidden, targetOf } from './dom.ts';
import { Spring } from './spring.ts';

// A press that moves 4px drags the thumb. Swollen by a drag or a tap, it stays so 170 ms after
// letting go.
const DRAG_START = 4;
const THUMB_SETTLE = 170;
// The thumb glides to an option on a spring a shade short of critical, so it comes to rest a
// hair past its place. Lifted, it swells to 1.74 by 1.58, a capsule wider than it is tall, on a
// looser spring that rings past full size, and once short of its own size when let go. Moving,
// it stretches along its way and flattens by its speed, a tenth for every 400 px a second up to
// three tenths, on a loose spring of its own, so it overshoots round once it stops and wobbles
// back. The options stay their own size above the lens. Through it the track looks squeezed
// toward the lens's middle, to 0.78 of its height once fully swollen, the ground above and below
// showing in its place: the track's fill (the group's `:before`) is cut out where the lens is and
// drawn again in a narrower band. Dragged past either end, the thumb goes a tenth as far as the
// pointer. A frame that comes late, after a stall (a map drawn anew) or a hidden page, moves it
// on no further than one of a twentieth of a second would, so it carries on from where it stopped.
const GLIDE = { stiffness: 600, damping: 38 },
  SWELL = { stiffness: 340, damping: 20 },
  STRETCH = { stiffness: 300, damping: 14 },
  HELD = { x: 1.74, y: 1.58 },
  STRETCH_SPEED = 4000,
  STRETCH_MOST = 0.3,
  SQUEEZE = 0.22,
  GIVE = 0.1,
  LONGEST_FRAME = 50,
  SCALE_DIGITS = 3;
// It comes to rest once nothing drawn can change any more: its place is drawn to a hundredth of a
// pixel, and its scales to a thousandth, which puts a lens a few hundred px wide to a hundredth too.
const UNSEEN = { x: 0.001, scale: 0.00001 };

// The thumb's outline as a mask image: a capsule that keeps its shape when stretched over the lens.
const outline = (width: number, height: number) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}' preserveAspectRatio='none'%3E%3Crect width='${width}' height='${height}' rx='${Math.min(width, height) / 2}'/%3E%3C/svg%3E")`;

// Where an option lies in its group, in the group's own px. Offsets round to whole px, too coarse
// for a thumb set a fraction of one inside its track, so this takes the rectangles, back by the
// share the group's rectangle is of its own width, which a zoom or a scale changes. They are kept to
// hundredths, so the same layout measured from another place on the page puts it in the same place.
const BOX_DIGITS = 2;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
function boxOf(group: HTMLElement, style: CSSStyleDeclaration, option: HTMLElement): Box {
  const outer = group.getBoundingClientRect(),
    inner = option.getBoundingClientRect(),
    own = parseFloat(style.width),
    share = own > 0 && outer.width > 0 ? outer.width / own : 1,
    inGroup = (value: number) => Number((value / share).toFixed(BOX_DIGITS));
  return {
    x: inGroup(inner.left - outer.left),
    y: inGroup(inner.top - outer.top),
    width: inGroup(inner.width),
    height: inGroup(inner.height),
  };
}

export class GlassSwitch {
  private readonly x = new Spring(0, GLIDE);
  private readonly swell = new Spring(0, SWELL);
  private readonly stretch = new Spring(0, STRETCH);
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly bound = new WeakSet<HTMLElement>();
  private readonly options: string;
  private readonly select: (option: HTMLElement) => void;
  private group: HTMLElement | undefined;
  private thumb: HTMLElement | undefined;
  private buttons: readonly HTMLElement[] = [];
  private placed = false;
  // The pressed option's box, where the thumb rests, measured when it is placed.
  private box: Box = { x: 0, y: 0, width: 0, height: 0 };
  private flat = false;
  private frame = 0;
  private last = 0;
  private drag: { id: number; start: number; from: number; zoom: number; moved: boolean; option: HTMLElement } | null =
    null;
  private ignoreHidden = () => {};
  private settle: number | undefined;
  // Set while an option is chosen, as that can draw the group again.
  private choosing = false;
  // `options` picks the group's options; `select` is told which one a tap or a drag chose.
  constructor(options: string, select: (option: HTMLElement) => void) {
    this.options = options;
    this.select = select;
  }
  // Takes the group, its thumb (`.thumb`) and its options, again whenever it is drawn anew.
  attach(group: HTMLElement) {
    if (group === this.group) return;
    // A press can't outlast its group, as its pointer went with it.
    if (this.drag) this.letGo();
    const moving = this.choosing || this.frame !== 0 || this.swell.target > 0;
    this.group = group;
    this.thumb = child(group, '.thumb');
    this.buttons = [...group.querySelectorAll<HTMLElement>(this.options)];
    if (!moving) this.placed = false;
    group.toggleAttribute('data-held', this.swell.target > 0);
    if (!this.bound.has(group)) this.bind(group);
    this.place();
    if (this.placed) this.draw();
  }
  // The thumb under the pressed option, gliding there from where it is, and whether the styles keep
  // it flat, as they may at one size and not another.
  place() {
    const { group, thumb } = this,
      option = this.buttons.find(each => each.getAttribute('aria-pressed') === 'true');
    if (!group || !thumb || !option) return;
    const style = getComputedStyle(group),
      box = boxOf(group, style, option);
    this.flat = style.getPropertyValue('--switch').trim() === 'flat';
    this.box = box;
    thumb.style.setProperty('--x', `${box.x}px`);
    thumb.style.setProperty('--w', `${box.width}px`);
    thumb.style.setProperty('--h', `${box.height}px`);
    thumb.style.setProperty('--y', `${box.y}px`);
    group.style.setProperty('--lens', outline(box.width, box.height));
    this.aim(box.x);
  }
  private bind(group: HTMLElement) {
    this.bound.add(group);
    group.addEventListener('pointerdown', event => {
      // A press anywhere on the switch, its rim and the room round it included (see the styles), takes
      // the option nearest it across.
      const option = targetOf(event, this.options) ?? this.under(event.clientX);
      if (!option || event.button !== 0) return;
      const width = parseFloat(getComputedStyle(group).width);
      this.drag = {
        id: event.pointerId,
        start: event.clientX,
        from: this.x.target,
        zoom: width ? group.getBoundingClientRect().width / width : 1,
        moved: false,
        option,
      };
      group.setPointerCapture(event.pointerId);
      this.ignoreHidden = onHidden(() => this.letGo());
    });
    group.addEventListener('pointermove', event => {
      const { drag, thumb, buttons } = this;
      if (drag?.id !== event.pointerId || !thumb || this.flat) return;
      const dx = (event.clientX - drag.start) / drag.zoom;
      if (!drag.moved && Math.abs(dx) < DRAG_START) return;
      if (!drag.moved) this.lift();
      drag.moved = true;
      const first = buttons[0],
        last = buttons.at(-1);
      if (!first || !last) return;
      const min = first.offsetLeft,
        max = last.offsetLeft + last.offsetWidth - thumb.offsetWidth,
        to = drag.from + dx,
        x = to < min ? min - (min - to) * GIVE : to > max ? max + (to - max) * GIVE : to;
      thumb.style.setProperty('--x', `${x}px`);
      this.aim(x);
    });
    const end = (event: PointerEvent) => {
      const { drag } = this;
      if (drag?.id !== event.pointerId) return;
      const chosen = drag.moved ? (this.nearest() ?? drag.option) : drag.option,
        up = event.type === 'pointerup';
      // A tap lifts the lens only now, to carry it over to the option chosen.
      if (up && !drag.moved) this.lift();
      this.letGo();
      if (up) this.choose(chosen);
    };
    group.addEventListener('pointerup', end);
    group.addEventListener('pointercancel', end);
    // Keyboard activation; pointer presses are handled above.
    group.addEventListener('click', event => {
      const option = targetOf(event, this.options);
      if (option && event.detail === 0) this.choose(option);
    });
  }
  private choose(option: HTMLElement) {
    this.choosing = true;
    try {
      this.select(option);
    } finally {
      this.choosing = false;
      // The choice draws the views it picks, which holds up the next frame. That time isn't counted
      // as gone by, so the thumb sets off from where it is rather than jumping ahead to catch up.
      this.last = performance.now();
    }
  }
  // The option nearest the thumb's middle, where it is headed rather than where it has got to.
  // The option whose middle is nearest a point across the screen.
  private under(x: number) {
    return this.buttons.reduce<{ option: HTMLElement | undefined; d: number }>(
      (best, option) => {
        const { left, width } = option.getBoundingClientRect(),
          d = Math.abs(left + width / 2 - x);
        return d < best.d ? { option, d } : best;
      },
      { option: undefined, d: Infinity },
    ).option;
  }
  private nearest() {
    const middle = this.x.target + (this.thumb?.offsetWidth ?? 0) / 2;
    return this.buttons.reduce<{ option: HTMLElement | undefined; d: number }>(
      (best, option) => {
        const d = Math.abs(option.offsetLeft + option.offsetWidth / 2 - middle);
        return d < best.d ? { option, d } : best;
      },
      { option: undefined, d: Infinity },
    ).option;
  }
  private letGo() {
    this.ignoreHidden();
    this.drag = null;
    this.place();
    window.clearTimeout(this.settle);
    this.settle = window.setTimeout(() => this.hold(false), THUMB_SETTLE);
  }
  private lift() {
    window.clearTimeout(this.settle);
    this.hold(true);
  }
  private hold(held: boolean) {
    const swollen = held && !this.flat;
    this.group?.toggleAttribute('data-held', swollen);
    this.swell.target = swollen ? 1 : 0;
    this.run();
  }
  // Sends it to `x`: from where it is, or straight there the first time it is laid out.
  private aim(x: number) {
    if (this.placed && this.x.target === x && this.x.resting) return;
    // Flat, it is there at once, drawn with the options' own change.
    if (this.placed && !this.flat) this.x.target = x;
    else this.x.snap(x);
    this.placed = (this.thumb?.offsetWidth ?? 0) > 0;
    if (this.flat) this.draw();
    else this.run();
  }
  private run() {
    if (this.still.matches) {
      this.x.snap();
      this.swell.snap(0);
      this.stretch.snap(0);
      this.draw();
      return;
    }
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }
  private readonly tick = (now: number) => {
    const ms = Math.min(LONGEST_FRAME, now - this.last);
    this.last = now;
    this.x.step(ms);
    this.stretch.target = this.flat ? 0 : Math.min(STRETCH_MOST, Math.abs(this.x.velocity) / STRETCH_SPEED);
    this.stretch.step(ms);
    this.swell.step(ms);
    // The stretch follows the glide's speed, which never comes to exactly nothing, so its own
    // target counts toward what is left of it.
    const resting =
      this.x.swing < UNSEEN.x &&
      this.swell.swing < UNSEEN.scale &&
      Math.abs(this.stretch.target) + this.stretch.swing < UNSEEN.scale;
    if (resting) {
      this.x.snap();
      this.swell.snap();
      this.stretch.snap(0);
    }
    this.draw();
    this.frame = resting ? 0 : requestAnimationFrame(this.tick);
  };
  private draw() {
    const { group, thumb } = this;
    if (!group || !thumb) return;
    const x = this.x.value,
      grow = this.swell.value,
      give = this.stretch.value,
      { width, height, y: top } = this.box,
      // Measured before anything is set, so the frame lays nothing out twice.
      track = group.clientHeight,
      wide = (1 + (HELD.x - 1) * grow) * (1 + give),
      tall = (1 + (HELD.y - 1) * grow) * (1 - give),
      squeeze = SQUEEZE * grow,
      lens = { width: width * wide, height: height * tall },
      px = (value: number) => `${value.toFixed(2)}px`,
      { style } = group;
    thumb.style.transform = `translateX(${x.toFixed(2)}px) scale(${wide.toFixed(SCALE_DIGITS)},${tall.toFixed(SCALE_DIGITS)})`;
    style.setProperty('--lens-x', px(x + (width - lens.width) / 2));
    style.setProperty('--lens-y', px(top + (height - lens.height) / 2));
    style.setProperty('--lens-w', px(lens.width));
    style.setProperty('--lens-h', px(lens.height));
    style.setProperty('--band-y', px((top + height / 2) * squeeze));
    style.setProperty('--band-h', px(track * (1 - squeeze)));
  }
}
