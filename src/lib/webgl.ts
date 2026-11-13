// What every WebGL layer shares: a program linked from its two shaders.

// A program linked from `vertex` and `fragment`, its attributes bound to locations in the order
// `attributes` names them. A shader that doesn't compile or a program that doesn't link throws,
// with the driver's own account of why, and leaves nothing behind; `name` says whose it was.
export function linkedProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  name: string,
  vertex: string,
  fragment: string,
  attributes: readonly string[] = [],
): WebGLProgram {
  const program = gl.createProgram(),
    shaders: WebGLShader[] = [];
  const discard = () => {
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteProgram(program);
  };
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) {
      discard();
      throw new Error(`The ${name} shader could not be created.`);
    }
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      const log = gl.getShaderInfoLog(shader);
      discard();
      throw new Error(log || `The ${name} shader did not compile.`);
    }
    gl.attachShader(program, shader);
  }
  for (const [location, attribute] of attributes.entries()) gl.bindAttribLocation(program, location, attribute);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program);
    discard();
    throw new Error(log || `The ${name} program did not link.`);
  }
  // Linked, the program keeps what it needs of them.
  for (const shader of shaders) gl.deleteShader(shader);
  return program;
}
// The same, or null where it can't be linked, for a layer that draws without it.
export function linkedOrNull(...args: Parameters<typeof linkedProgram>): WebGLProgram | null {
  try {
    return linkedProgram(...args);
  } catch {
    return null;
  }
}
