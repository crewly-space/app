/*
 * Bloop is a small renderer-focused avatar generator. It has no app, account,
 * network or backend dependency: a stable seed plus a subject kind produces
 * the same SVG on every surface.
 */

export type BloopKind = "user" | "agent";

export const BLOOP_TONES = 6;
const EYES = ["dots", "tall", "wide"] as const;
const MOUTHS = ["smile", "flat", "none"] as const;

export type BloopFeatures = {
  kind: BloopKind;
  tone: number;
  eyes: (typeof EYES)[number];
  mouth: (typeof MOUTHS)[number];
  lobes: number[];
};

function hash(seed: string): number {
  let value = 2166136261;
  for (const char of seed.trim().toLowerCase()) {
    value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return value;
}

function stream(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/** Stable features for one identity. Use an id rather than a display name. */
export function bloopFeatures(seed: string, kind: BloopKind): BloopFeatures {
  const base = hash(`${kind}:${seed.trim().toLowerCase()}`);
  const next = stream(base);
  return {
    kind,
    tone: base % BLOOP_TONES,
    eyes: EYES[Math.floor(next() * EYES.length)],
    mouth: MOUTHS[Math.floor(next() * MOUTHS.length)],
    lobes: Array.from({ length: 8 }, () => 7.6 + next() * 1.6),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

function bodyPath(lobes: number[], cx: number, cy: number): string {
  const points = lobes.map((radius, index) => {
    const angle = (index / lobes.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
  });
  const at = (index: number) => points[(index + points.length) % points.length];
  let path = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let index = 0; index < points.length; index += 1) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return `${path}Z`;
}

function eyes(style: BloopFeatures["eyes"], kind: BloopKind): string {
  if (kind === "agent") {
    if (style === "wide") return '<rect class="bloop-eye" x="8" y="11" width="8" height="2.8" rx="1.4"/>';
    const height = style === "tall" ? 3.6 : 2.4;
    return `<rect class="bloop-eye" x="8.6" y="${round(12.6 - height / 2)}" width="2" height="${height}" rx="0.8"/>`
      + `<rect class="bloop-eye" x="13.4" y="${round(12.6 - height / 2)}" width="2" height="${height}" rx="0.8"/>`;
  }
  if (style === "tall") {
    return '<ellipse class="bloop-eye" cx="9.6" cy="12" rx="1.1" ry="1.7"/><ellipse class="bloop-eye" cx="14.4" cy="12" rx="1.1" ry="1.7"/>';
  }
  const gap = style === "wide" ? 3 : 2.3;
  return `<circle class="bloop-eye" cx="${round(12 - gap)}" cy="12.2" r="1.2"/><circle class="bloop-eye" cx="${round(12 + gap)}" cy="12.2" r="1.2"/>`;
}

function mouth(style: BloopFeatures["mouth"]): string {
  if (style === "smile") return '<path class="bloop-line" d="M10.3 15.4q1.7 1.5 3.4 0"/>';
  if (style === "flat") return '<path class="bloop-line" d="M10.8 15.8h2.4"/>';
  return "";
}

/** Safe inline SVG made entirely from fixed shapes and numeric features. */
export function bloopSvg(seed: string, kind: BloopKind): string {
  const features = bloopFeatures(seed, kind);
  const antenna = kind === "agent"
    ? '<path class="bloop-line bloop-antenna" d="M12 4.6V2.4"/><circle class="bloop-dot" cx="12" cy="1.9" r="1.1"/>'
    : "";
  return (
    `<svg class="bloop bloop-${kind} bloop-tone-${features.tone}" viewBox="0 0 24 24" focusable="false">` +
    antenna +
    `<path class="bloop-body" d="${bodyPath(features.lobes, 12, 12.6)}"/>` +
    eyes(features.eyes, kind) +
    mouth(features.mouth) +
    "</svg>"
  );
}
