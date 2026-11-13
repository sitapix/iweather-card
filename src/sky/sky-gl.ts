// One WebGL2 context for the sky's layers that draw on the GPU out of sight and copy what they draw
// straight out, the clouds and the moon, where each held one of its own. Each sets all it draws with
// (its program, vertex array, textures, blending) before it draws, as the other may have changed it.
//
// A context is asked of the browser only where it doesn't emulate the GPU in software. A layer that
// will draw on an emulated one (the moon, and the clouds under test) gets a context of its own on a
// machine with nothing else, as it had.
export interface SkyGl {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}
let fast: SkyGl | null | undefined, emulated: SkyGl | null | undefined;

function made(software: boolean): SkyGl | null {
  const canvas = document.createElement('canvas'),
    gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: !software,
    });
  if (!gl) return null;
  const sky = { canvas, gl };
  // Lost (the GPU reset, or the page holding too many), it is made afresh when next asked for.
  canvas.addEventListener('webglcontextlost', () => {
    if (fast === sky) fast = undefined;
    if (emulated === sky) emulated = undefined;
  });
  return sky;
}

// The sky's context, or null if there is none to be had; `software` takes an emulated GPU where
// there is no other.
export function skyGl(software: boolean): SkyGl | null {
  if (fast === undefined) fast = made(false);
  if (fast || !software) return fast;
  emulated ??= made(true);
  return emulated;
}
