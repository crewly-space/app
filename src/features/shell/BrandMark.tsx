export function BrandMark() {
  return (
    <span className="brand-mark">
      <i />
      <b />
    </span>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <BrandMark />
      <span>Opening your crew…</span>
    </div>
  );
}
