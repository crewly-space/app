/*
 * Bloop is a small renderer-focused avatar generator. It has no app, account,
 * network or backend dependency: a stable seed plus a subject kind produces
 * the same SVG on every surface.
 */

export type BloopKind = "user" | "agent";

export const BLOOP_TONES = 6;
const EYES = ["tall", "short", "wide"] as const;
const LEAVES = ["pair", "trio", "sprout"] as const;

/*
 * Every Bloop is one of the radishes from the Crewly mark: an arched body on
 * a flat, rounded base, two pill eyes, and leaves on top. The seed picks the
 * leaves, eyes and proportions, so one identity always draws the same radish.
 */
export type BloopFeatures = {
  kind: BloopKind;
  /** Outline colour for a person; an agent is always outlined in the accent. */
  tone: number;
  eyes: (typeof EYES)[number];
  leaves: (typeof LEAVES)[number];
  /** Body width, in viewBox units. */
  width: number;
  /** Height of the straight sides below the arch. */
  shoulder: number;
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

const round = (value: number) => Math.round(value * 100) / 100;

/** Stable features for one identity. Use an id rather than a display name. */
export function bloopFeatures(seed: string, kind: BloopKind): BloopFeatures {
  const base = hash(`${kind}:${seed.trim().toLowerCase()}`);
  const next = stream(base);
  return {
    kind,
    tone: base % BLOOP_TONES,
    eyes: EYES[Math.floor(next() * EYES.length)],
    leaves: LEAVES[Math.floor(next() * LEAVES.length)],
    width: round(13.5 + next() * 3),
    shoulder: round(4.5 + next() * 2.5),
  };
}

/* The mark's top radish is 40 wide with an arch 1.1 times as tall as it is
   half wide, and leaves about 9 tall; these are the same proportions in 24. */
const ARCH = 1.1;
const LEAF_RISE = 6;

type Frame = { base: number; left: number; right: number; top: number; crown: number };

/** Where everything sits so the whole radish, leaves included, is centred. */
function frame({ width, shoulder }: BloopFeatures): Frame {
  const archHeight = (width / 2) * ARCH;
  const base = round(12 + (shoulder + archHeight + LEAF_RISE) / 2);
  const top = round(base - shoulder);
  return {
    base,
    left: round(12 - width / 2),
    right: round(12 + width / 2),
    top,
    crown: round(top - archHeight),
  };
}

function bodyPath(features: BloopFeatures, f: Frame): string {
  const rx = round(features.width / 2);
  const ry = round(rx * ARCH);
  const corner = 2;
  return `M${f.left} ${f.top}A${rx} ${ry} 0 0 1 ${f.right} ${f.top}`
    + `V${round(f.base - corner)}Q${f.right} ${f.base} ${round(f.right - corner)} ${f.base}`
    + `H${round(f.left + corner)}Q${f.left} ${f.base} ${f.left} ${round(f.base - corner)}Z`;
}

function leaf(cx: number, cy: number, ry: number, angle: number): string {
  return `<ellipse class="bloop-leaf" cx="${round(cx)}" cy="${round(cy)}" rx="1.5" ry="${ry}" transform="rotate(${angle} ${round(cx)} ${round(cy)})"/>`;
}

/** The mark's leaves, drawn first so the body covers where they join it. */
function leaves(style: BloopFeatures["leaves"], f: Frame): string {
  const cy = f.crown - 2.2;
  if (style === "trio") return leaf(9.6, cy + 0.6, 2.8, -28) + leaf(14.4, cy + 0.6, 2.8, 28) + leaf(12, cy - 0.6, 3.2, 0);
  if (style === "sprout") return leaf(10.8, cy, 3.4, -12) + leaf(13.9, cy + 0.9, 2.4, 34);
  return leaf(10.3, cy, 3.3, -16) + leaf(13.7, cy, 3.3, 16);
}

/** Two pill eyes under the crown, as in the mark. */
function eyes(style: BloopFeatures["eyes"], f: Frame): string {
  const height = style === "tall" ? 4.6 : 3.6;
  const gap = style === "wide" ? 2.9 : 2.2;
  const w = 2.4;
  const y = round(f.top - 2.2);
  return [12 - gap, 12 + gap]
    .map((cx) => `<rect class="bloop-eye" x="${round(cx - w / 2)}" y="${y}" width="${w}" height="${height}" rx="${w / 2}"/>`)
    .join("");
}

/** Safe inline SVG made entirely from fixed shapes and numeric features. */
export function bloopSvg(seed: string, kind: BloopKind): string {
  const features = bloopFeatures(seed, kind);
  const f = frame(features);
  const tone = kind === "user" ? ` bloop-tone-${features.tone}` : "";
  return (
    `<svg class="bloop bloop-${kind}${tone}" viewBox="0 0 24 24" focusable="false">` +
    leaves(features.leaves, f) +
    `<path class="bloop-body" d="${bodyPath(features, f)}"/>` +
    eyes(features.eyes, f) +
    "</svg>"
  );
}
