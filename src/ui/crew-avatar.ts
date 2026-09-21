/*
 * The crew's avatar: a black character with an accent outline, in the same
 * language as the Crewly mark.
 *
 * The geometry lives here so the app and the website draw the same faces.
 * Colours are not set here -- the .crew-svg rules in css/components.css read
 * them from the tokens, so light and dark themes both work.
 */

export const CREW_VARIANTS = [
  "ears",
  "visor",
  "antenna",
  "plain",
  "cyclops",
  "happy",
] as const;

export type CrewVariant = (typeof CREW_VARIANTS)[number];

/** The same name always gets the same face, on every surface. */
export function crewVariantFor(name: string): CrewVariant {
  let hash = 2166136261;
  for (const char of name.trim().toLowerCase()) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return CREW_VARIANTS[hash % CREW_VARIANTS.length];
}

const TWO_EYES =
  '<rect class="crew-eye" x="8.5" y="11" width="2" height="4.2" rx="1"/>' +
  '<rect class="crew-eye" x="13.5" y="11" width="2" height="4.2" rx="1"/>';

const DETAILS: Record<CrewVariant, string> = {
  ears: '<path class="crew-line" d="M9.2 4.6 8.2 1.8M14.8 4.6l1-2.8"/>' + TWO_EYES,
  visor: '<rect class="crew-eye" x="7" y="11" width="10" height="3.6" rx="1.8"/>',
  antenna:
    '<path class="crew-line" d="M12 4V2"/><circle class="crew-dot" cx="12" cy="1.6" r="1"/>' +
    TWO_EYES,
  plain: TWO_EYES,
  cyclops: '<circle class="crew-eye" cx="12" cy="13" r="2.6"/>',
  happy:
    '<path class="crew-line" d="M8 14.6q1.3-2.6 2.6 0M13.4 14.6q1.3-2.6 2.6 0"/>',
};

/**
 * The avatar as an inline SVG string. `you` draws the outline in the text
 * colour instead of the accent, so the reader is never mistaken for an agent.
 */
export function crewAvatarSvg(variant: CrewVariant, you = false): string {
  return (
    `<svg class="crew-svg${you ? " is-you" : ""}" viewBox="0 0 24 24" focusable="false">` +
    '<path class="crew-body" d="M4 19v-7a8 8 0 0 1 16 0v7q0 1.5-1.5 1.5h-13Q4 20.5 4 19Z"/>' +
    DETAILS[variant] +
    "</svg>"
  );
}
