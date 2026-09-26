import { useEffect, useState } from "react";

export function BrandMark() {
  return (
    <span className="brand-mark">
      <i />
      <b />
    </span>
  );
}

/** Wording only appears if loading is not over almost at once; a fast start shows no flicker of text. */
const SAY_AFTER_MS = 1200;
/** Past this, animating on is no longer an answer: say so and offer a way out. */
export const SLOW_AFTER_MS = 8000;

/**
 * What the app looks like while it is getting ready: the shape of the shell
 * it is about to show -- sidebar, header, a few messages, the composer --
 * with the brand mark, rather than a blank page with one line of text.
 *
 * It says what is happening only when that takes long enough to wonder, and
 * after SLOW_AFTER_MS turns into something to act on. Motion is a gentle
 * shimmer that `prefers-reduced-motion` switches off.
 */
export function Loading({
  phase = "Opening your crew…",
  onRetry,
  slowAfterMs = SLOW_AFTER_MS,
  embedded = false,
}: {
  phase?: string;
  /** Offered once loading is slow; without it, the page is reloaded. */
  onRetry?: () => void;
  slowAfterMs?: number;
  /** Inside the hosted app's main area, beside the rail, rather than the whole page. */
  embedded?: boolean;
}) {
  const [elapsed, setElapsed] = useState<"quick" | "saying" | "slow">("quick");
  useEffect(() => {
    const say = window.setTimeout(() => setElapsed("saying"), SAY_AFTER_MS);
    const slow = window.setTimeout(() => setElapsed("slow"), slowAfterMs);
    return () => { window.clearTimeout(say); window.clearTimeout(slow); };
  }, [slowAfterMs]);

  return (
    <div className={`boot-skeleton${embedded ? " embedded" : ""}`} role="status" aria-live="polite" aria-busy={elapsed !== "slow"}>
      <div className="boot-skeleton-sidebar" aria-hidden="true">
        <BrandMark />
        <i className="bone wide" />
        <i className="bone" />
        <i className="bone" />
        <i className="bone short" />
        <i className="bone" />
      </div>
      <div className="boot-skeleton-main">
        <div className="boot-skeleton-header" aria-hidden="true"><i className="bone short" /></div>
        <div className="boot-skeleton-messages" aria-hidden="true">
          <i className="bone wide" />
          <i className="bone" />
          <i className="bone wide" />
        </div>
        <div className="boot-skeleton-status">
          {elapsed === "slow" ? (
            <div className="boot-skeleton-slow">
              <strong>This is taking longer than usual.</strong>
              <span>{phase.replace(/…$/, "")} has not finished yet. The server may be slow or unreachable.</span>
              <button type="button" className="secondary-button" onClick={() => (onRetry ? onRetry() : window.location.reload())}>
                Try again
              </button>
            </div>
          ) : (
            <span className={elapsed === "saying" ? "boot-skeleton-phase shown" : "boot-skeleton-phase"}>{phase}</span>
          )}
        </div>
        <div className="boot-skeleton-composer" aria-hidden="true" />
      </div>
    </div>
  );
}
