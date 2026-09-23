import { useEffect, useRef } from "react";

/*
 * Overlays: dialogs, panels and the mobile scrim.
 *
 * Every overlay registers as a layer so Escape closes only the top one, and a
 * dialog traps focus and hands it back to whatever opened it.
 */

export const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Open overlays, oldest first. Escape only ever dismisses the top one, so a
// modal opened from a panel does not close both at once.
export const layers: { dismiss: () => void }[] = [];

export function useLayer<T extends HTMLElement>(onDismiss: () => void, trap: boolean) {
  const ref = useRef<T>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  // Captured during render: by the time effects run React has already honoured
  // any autoFocus inside the dialog, so the trigger would be lost.
  const restoreTo = useRef<HTMLElement | null>(null);
  if (restoreTo.current === null) {
    restoreTo.current = document.activeElement as HTMLElement | null;
  }
  // Set when this effect (re)runs, so the throwaway cleanup StrictMode performs
  // between the two mount passes does not yank focus back out of the dialog.
  const restoreCancelled = useRef(false);

  useEffect(() => {
    restoreCancelled.current = true;
    const layer = { dismiss: () => dismiss.current() };
    layers.push(layer);
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((element) => element.offsetParent !== null);
    if (trap && !ref.current?.contains(document.activeElement)) {
      (focusable()[0] ?? ref.current)?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== layer) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        layer.dismiss();
        return;
      }
      if (!trap || event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const [first] = items;
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (
        event.shiftKey &&
        (active === first || !ref.current?.contains(active))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      layers.splice(layers.indexOf(layer), 1);
      if (!trap) return;
      const trigger = restoreTo.current;
      restoreCancelled.current = false;
      // A microtask, not rAF: rAF is throttled to nothing in a hidden tab.
      queueMicrotask(() => {
        if (restoreCancelled.current) return;
        if (trigger && document.contains(trigger)) trigger.focus();
      });
    };
  }, [trap]);

  return ref;
}

export const useDialog = (onClose: () => void) =>
  useLayer<HTMLDivElement>(onClose, true);

export function Scrim({ onClose }: { onClose: () => void }) {
  const ref = useLayer<HTMLButtonElement>(onClose, false);
  return (
    <button
      ref={ref}
      className="scrim"
      onClick={onClose}
      aria-label="Close navigation"
    />
  );
}
