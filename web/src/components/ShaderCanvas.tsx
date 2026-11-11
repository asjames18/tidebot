import { useEffect, useRef } from 'react';
import type { ShaderStyle } from '@shared/types';

const VERT_SRC = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

function getFragSrc(style: ShaderStyle): string {
  const modeIndex = style === 'aurora' ? 0 : style === 'plasma' ? 1 : style === 'obsidian' ? 2 : style === 'vortex' ? 3 : 4;
  return `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / max(u_res.xy, vec2(1.0));
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res.xy) / max(u_res.y, 1.0);
  float t = u_time * 0.28;
  int mode = ${modeIndex};

  vec3 col = vec3(0.03, 0.04, 0.07);

  if (mode == 0) {
    // Aurora Tide: layered domain-warped oceanic silk ribbons
    vec2 q = vec2(fbm(p * 2.2 + vec2(0.0, t * 0.6)), fbm(p * 2.2 + vec2(5.2, 1.3 - t * 0.4)));
    vec2 r = vec2(fbm(p * 2.8 + 3.2 * q + vec2(1.7, 9.2 + t * 0.5)), fbm(p * 2.8 + 3.2 * q + vec2(8.3, 2.8 - t * 0.35)));
    float f = fbm(p * 2.0 + 2.5 * r);
    float wave = sin(p.y * 5.0 + f * 4.5 - t * 1.6) * 0.5 + 0.5;
    vec3 c1 = vec3(0.03, 0.04, 0.08);
    vec3 c2 = vec3(0.06, 0.42, 0.72); // cyan tide
    vec3 c3 = vec3(0.35, 0.28, 0.88); // indigo crest
    vec3 c4 = vec3(0.14, 0.82, 0.92); // specular aqua
    col = mix(c1, c2, smoothstep(0.15, 0.85, f));
    col = mix(col, c3, smoothstep(0.3, 0.9, length(q)));
    col += c4 * pow(wave * f, 2.4) * 0.48;
  } else if (mode == 1) {
    // Plasma Tide: chromatic Interference field
    float v1 = sin(p.x * 4.5 + t);
    float v2 = sin(4.5 * (p.x * sin(t * 0.5) + p.y * cos(t * 0.35)) + t);
    vec2 c = p + vec2(sin(t * 0.4), cos(t * 0.6)) * 0.5;
    float v3 = sin(sqrt(dot(c, c) * 18.0 + 1.0) - t * 1.8);
    float v = (v1 + v2 + v3) * 0.333;
    vec3 base = vec3(0.04, 0.05, 0.09);
    vec3 accent = 0.5 + 0.5 * cos(3.8 * v + vec3(0.2, 1.4, 2.7) + t * 0.5);
    col = mix(base, accent, 0.42);
  } else if (mode == 2) {
    // Obsidian Mesh: dark metallic liquid glass with sharp caustics
    vec2 q = p * 3.0;
    float n1 = fbm(q + vec2(t * 0.35, -t * 0.25));
    float n2 = fbm(q * 1.4 - vec2(n1 * 2.2, t * 0.3));
    float spec = pow(max(0.0, 1.0 - abs(n2 - 0.5) * 4.5), 3.0);
    col = vec3(0.03, 0.035, 0.055) + vec3(0.08, 0.14, 0.26) * n2 + vec3(0.38, 0.72, 1.0) * spec * 0.45;
  } else if (mode == 3) {
    // Vortex Singularity: orbital energy rings
    float r = length(p);
    float a = atan(p.y, p.x);
    float swirl = a + 2.4 / (r + 0.22) - t * 1.5;
    float bands = sin(swirl * 3.0) * 0.5 + 0.5;
    float glow = exp(-r * 2.4);
    float halo = smoothstep(0.55, 0.12, abs(r - 0.28 + 0.04 * sin(a * 4.0 + t)));
    col = vec3(0.03, 0.04, 0.07);
    col += vec3(0.12, 0.55, 0.95) * bands * glow * 0.85;
    col += vec3(0.52, 0.32, 0.96) * halo * 0.65;
  } else {
    // 3D Horizon Grid (scrolltide 3D depth)
    float horizon = 0.18;
    if (p.y < horizon) {
      float z = 0.22 / max(horizon - p.y, 0.015);
      float x = p.x * z;
      float gx = abs(fract(x * 1.4) - 0.5);
      float gz = abs(fract(z * 1.2 - t * 2.2) - 0.5);
      float line = smoothstep(0.06, 0.01, min(gx, gz));
      float fade = exp(-(z - 0.4) * 0.24);
      col = vec3(0.025, 0.03, 0.06) + vec3(0.18, 0.74, 0.98) * line * fade * 0.72;
    } else {
      float glow = exp(-(p.y - horizon) * 5.0);
      col = vec3(0.025, 0.03, 0.06) + vec3(0.28, 0.36, 0.88) * glow * 0.55;
    }
  }

  // Subtle vignette
  float vig = smoothstep(1.25, 0.2, length(uv - 0.5));
  col *= mix(0.6, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;
}

export function ShaderCanvas({
  style = 'aurora',
  className = '',
  opacity = 1,
}: {
  style?: ShaderStyle;
  className?: string;
  opacity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, getFragSrc(style));
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(prog, 'u_res');
    const timeLoc = gl.getUniformLocation(prog, 'u_time');

    let raf = 0;
    let lastFrame = 0;
    let visible = true;
    const start = performance.now();

    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; })
      : null;
    io?.observe(canvas);

    const render = (nowMs: number) => {
      raf = requestAnimationFrame(render);
      if (!visible || document.hidden) return;
      if (nowMs - lastFrame < 33) return; // 30fps cap for cool, quiet GPU usage
      lastFrame = nowMs;

      const scale = 0.6;
      const w = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const h = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(resLoc, w, h);
      gl.uniform1f(timeLoc, (nowMs - start) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [style]);

  return (
    <canvas
      ref={canvasRef}
      className={`tideos-shader-canvas ${className}`}
      style={{ opacity, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}
