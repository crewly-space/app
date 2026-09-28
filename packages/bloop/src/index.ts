/*
 * Bloop is a small renderer-focused avatar generator. It has no app, account,
 * network or backend dependency: a stable seed plus a subject kind produces
 * the same SVG on every surface.
 */

export type BloopKind = "user" | "agent";

export const BLOOP_TONES = 8;
const BODIES = ["classic", "slim", "wide"] as const;
const LEAVES = ["pair", "trio", "sprout", "single", "bunny", "fan"] as const;
const EYES = ["tall", "short", "wide", "close", "sleepy", "wink"] as const;
const FACES = ["plain", "blush", "smile", "oh"] as const;

/*
 * Every Bloop is one of the radishes from the Crewly mark: an arched body on
 * a flat, rounded base, pink pill eyes, and leaves on top. The seed picks one
 * of each option below, so one identity always draws the same radish and two
 * identities rarely share one: 3 x 6 x 6 x 4 shapes, and 8 outlines for people.
 */
export type BloopFeatures = {
  kind: BloopKind;
  /** Outline colour for a person; an agent is always outlined in the accent. */
  tone: number;
  body: (typeof BODIES)[number];
  leaves: (typeof LEAVES)[number];
  eyes: (typeof EYES)[number];
  face: (typeof FACES)[number];
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

const pick = <T,>(options: readonly T[], next: () => number): T => options[Math.floor(next() * options.length)];

/** Stable features for one identity. Use an id rather than a display name. */
export function bloopFeatures(seed: string, kind: BloopKind): BloopFeatures {
  const base = hash(`${kind}:${seed.trim().toLowerCase()}`);
  const next = stream(base);
  next();
  return {
    kind,
    tone: base % BLOOP_TONES,
    body: pick(BODIES, next),
    leaves: pick(LEAVES, next),
    eyes: pick(EYES, next),
    face: pick(FACES, next),
  };
}

/* Proportions of the mark's top radish, in a 24 box: the arch is 1.1 times as
   tall as it is half wide. Each body is a clearly different silhouette. */
const ARCH = 1.1;
const SHAPES: Record<BloopFeatures["body"], { width: number; shoulder: number }> = {
  classic: { width: 15, shoulder: 5 },
  slim: { width: 12.6, shoulder: 6.6 },
  wide: { width: 17.4, shoulder: 4.4 },
};
const LEAF_RISE = 6;

type Frame = { base: number; left: number; right: number; top: number; crown: number; width: number };

/** Where everything sits so the whole radish, leaves included, is centred. */
function frame(body: BloopFeatures["body"]): Frame {
  const { width, shoulder } = SHAPES[body];
  const archHeight = (width / 2) * ARCH;
  const base = round(12 + (shoulder + archHeight + LEAF_RISE) / 2);
  const top = round(base - shoulder);
  return { base, top, width, left: round(12 - width / 2), right: round(12 + width / 2), crown: round(top - archHeight) };
}

function bodyPath(f: Frame): string {
  const rx = round(f.width / 2);
  const ry = round(rx * ARCH);
  const corner = 2;
  return `M${f.left} ${f.top}A${rx} ${ry} 0 0 1 ${f.right} ${f.top}`
    + `V${round(f.base - corner)}Q${f.right} ${f.base} ${round(f.right - corner)} ${f.base}`
    + `H${round(f.left + corner)}Q${f.left} ${f.base} ${f.left} ${round(f.base - corner)}Z`;
}

function leaf(cx: number, cy: number, ry: number, angle: number, rx = 1.5): string {
  return `<ellipse class="bloop-leaf" cx="${round(cx)}" cy="${round(cy)}" rx="${rx}" ry="${ry}" transform="rotate(${angle} ${round(cx)} ${round(cy)})"/>`;
}

/** Leaves, drawn first so the body covers where they join it. */
function leaves(style: BloopFeatures["leaves"], f: Frame): string {
  const cy = f.crown - 2.2;
  switch (style) {
    case "trio": return leaf(9.4, cy + 0.7, 2.7, -32) + leaf(14.6, cy + 0.7, 2.7, 32) + leaf(12, cy - 0.7, 3.2, 0);
    case "sprout": return leaf(10.9, cy - 0.2, 3.5, -10) + leaf(14.2, cy + 1.1, 2.2, 48);
    case "single": return leaf(12, cy - 0.5, 3.6, 8, 1.8);
    case "bunny": return leaf(10.6, cy - 0.8, 3.9, -6, 1.3) + leaf(13.4, cy - 0.8, 3.9, 6, 1.3);
    case "fan": return leaf(8.9, cy + 1.3, 2.2, -52, 1.2) + leaf(10.8, cy, 2.7, -18, 1.2) + leaf(13.2, cy, 2.7, 18, 1.2) + leaf(15.1, cy + 1.3, 2.2, 52, 1.2);
    default: return leaf(10.3, cy, 3.3, -16) + leaf(13.7, cy, 3.3, 16);
  }
}

const pill = (cx: number, y: number, w: number, h: number) =>
  `<rect class="bloop-eye" x="${round(cx - w / 2)}" y="${round(y)}" width="${w}" height="${h}" rx="${round(Math.min(w, h) / 2)}"/>`;

/** Two eyes under the crown; the mark's are tall pills, the rest vary them. */
function eyes(style: BloopFeatures["eyes"], f: Frame): string {
  const y = f.top - 3;
  switch (style) {
    case "short": return pill(9.8, y + 0.8, 2.4, 3.2) + pill(14.2, y + 0.8, 2.4, 3.2);
    case "wide": return pill(8.9, y, 2.3, 4.2) + pill(15.1, y, 2.3, 4.2);
    case "close": return pill(10.6, y - 0.2, 2, 4.8) + pill(13.4, y - 0.2, 2, 4.8);
    case "sleepy": return pill(9.6, y + 1.8, 3, 1.5) + pill(14.4, y + 1.8, 3, 1.5);
    case "wink": return pill(9.7, y, 2.4, 4.6) + `<path class="bloop-eye-line" d="M13 ${round(y + 2.6)}q1.4 -1.4 2.8 0"/>`;
    default: return pill(9.8, y, 2.4, 4.6) + pill(14.2, y, 2.4, 4.6);
  }
}

/** A small extra below the eyes. */
function face(style: BloopFeatures["face"], f: Frame): string {
  const y = f.top + 2.4;
  switch (style) {
    case "blush": return `<ellipse class="bloop-blush" cx="${round(f.left + 2.7)}" cy="${round(y - 0.9)}" rx="1.4" ry="0.8"/>`
      + `<ellipse class="bloop-blush" cx="${round(f.right - 2.7)}" cy="${round(y - 0.9)}" rx="1.4" ry="0.8"/>`;
    case "smile": return `<path class="bloop-eye-line" d="M10.8 ${round(y)}q1.2 1.1 2.4 0"/>`;
    case "oh": return `<ellipse class="bloop-mouth" cx="12" cy="${round(y + 0.2)}" rx="0.9" ry="1"/>`;
    default: return "";
  }
}

/** Safe inline SVG made entirely from fixed shapes and enumerated features. */
export function bloopSvg(seed: string, kind: BloopKind): string {
  const features = bloopFeatures(seed, kind);
  const f = frame(features.body);
  const tone = kind === "user" ? ` bloop-tone-${features.tone}` : "";
  return (
    `<svg class="bloop bloop-${kind}${tone}" viewBox="0 0 24 24" focusable="false">` +
    leaves(features.leaves, f) +
    `<path class="bloop-body" d="${bodyPath(f)}"/>` +
    eyes(features.eyes, f) +
    face(features.face, f) +
    "</svg>"
  );
}
