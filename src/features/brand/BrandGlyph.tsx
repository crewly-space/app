import { BRAND_PATHS, type Brand } from "./brand-paths";

export type { Brand };

export const isBrand = (value: string): value is Brand => Object.hasOwn(BRAND_PATHS, value);

/** A product's own mark, single-colour so it takes the text colour of wherever it sits. */
export function BrandGlyph({ brand, size = 18 }: { brand: Brand; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={BRAND_PATHS[brand]} />
    </svg>
  );
}
