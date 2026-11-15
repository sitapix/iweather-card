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

// The four corners of a unit square, drawn as a triangle strip. Attribute zero is backed by
// vertex data on every draw, including on desktop OpenGL implementations.
export function unitQuad(gl: WebGL2RenderingContext) {
  const shape = gl.createVertexArray(),
    corners = gl.createBuffer();
  gl.bindVertexArray(shape);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return { shape, corners };
}
