// Keep deadlines on their original cadence instead of starting another interval
// at each draw. A late callback must not permanently lower the animation rate.
const FRAME_TOLERANCE = 1;

export function animationDeadline(now: number, due: number, interval: number): number | undefined {
  if (now + FRAME_TOLERANCE < due) return undefined;
  if (!due || now - due >= interval) return now + interval;
  return due + interval;
}
