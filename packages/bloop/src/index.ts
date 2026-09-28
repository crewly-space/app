/*
 * Bloop is a small renderer-focused avatar generator. It has no app, account,
 * network or backend dependency: a stable seed plus a subject kind produces
 * the same SVG on every surface.
 */

export type BloopKind = "user" | "agent";

export const BLOOP_TONES = 6;
const EYES = ["short", "tall", "wide"] as const;

/*
 * A Bloop is one of the crew from the Crewly mark: an arched body with a flat,
 * softly rounded base and two pill eyes. Agents wear the mark's pair of ears.
 */
export type BloopFeatures = {
  kind: BloopKind;
  tone: number;
  eyes: (typeof EYES)[number];
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
    width: round(13.5 + next() * 3),
    shoulder: round(5 + next() * 2.5),
  };
}

const EAR_RISE = 4.8;

/** Where the base sits so the whole figure, ears included, is centred. */
function baseline({ kind, width, shoulder }: BloopFeatures): number {
  const height = shoulder + (width / 2) * 1.1 + (kind === "agent" ? EAR_RISE : 0);
  return round(Math.min(22.6, 12 + height / 2));
}

/** The arch of the mark: a half-ellipse on straight sides, rounded at the base. */
function bodyPath(features: BloopFeatures): string {
  const { width, shoulder } = features;
  const BASE = baseline(features);
  const left = round(12 - width / 2);
  const right = round(12 + width / 2);
  const rx = round(width / 2);
  const ry = round(rx * 1.1);
  const top = round(BASE - shoulder);
  const corner = 2;
  return `M${left} ${top}A${rx} ${ry} 0 0 1 ${right} ${top}`
    + `V${round(BASE - corner)}Q${right} ${BASE} ${round(right - corner)} ${BASE}`
    + `H${round(left + corner)}Q${left} ${BASE} ${left} ${round(BASE - corner)}Z`;
}

/** Two pill eyes, sat just under the crown as in the mark. */
function eyes(features: BloopFeatures): string {
  const height = features.eyes === "tall" ? 5 : 4;
  const gap = features.eyes === "wide" ? 3 : 2.3;
  const w = 2.4;
  const y = round(baseline(features) - features.shoulder - 1.6);
  return [12 - gap, 12 + gap]
    .map((cx) => `<rect class="bloop-eye" x="${round(cx - w / 2)}" y="${y}" width="${w}" height="${height}" rx="${w / 2}"/>`)
    .join("");
}

/** The mark's two leaf ears, leaning apart above the crown. */
function ears(features: BloopFeatures): string {
  const crown = round(baseline(features) - features.shoulder - (features.width / 2) * 1.1);
  const cy = round(crown - 2.2);
  return `<ellipse class="bloop-ear bloop-antenna" cx="10.2" cy="${cy}" rx="1.3" ry="2.8" transform="rotate(-16 10.2 ${cy})"/>`
    + `<ellipse class="bloop-ear bloop-antenna" cx="13.8" cy="${cy}" rx="1.3" ry="2.8" transform="rotate(16 13.8 ${cy})"/>`;
}

/** Safe inline SVG made entirely from fixed shapes and numeric features. */
export function bloopSvg(seed: string, kind: BloopKind): string {
  const features = bloopFeatures(seed, kind);
  return (
    `<svg class="bloop bloop-${kind} bloop-tone-${features.tone}" viewBox="0 0 24 24" focusable="false">` +
    (kind === "agent" ? ears(features) : "") +
    `<path class="bloop-body" d="${bodyPath(features)}"/>` +
    eyes(features) +
    "</svg>"
  );
}
