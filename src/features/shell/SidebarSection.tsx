import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export function SidebarSection({
  title,
  action,
  actionLabel,
  actionDisabledReason,
  children,
}: {
  title: string;
  action?: () => void;
  /** What the + does, for people who cannot see the icon. Defaults to "Add <title>". */
  actionLabel?: string;
  /**
   * Set when the person may not do this here. The + stays visible but
   * disabled and says why, so the feature does not look absent.
   */
  actionDisabledReason?: string;
  children: ReactNode;
}) {
  const label = actionLabel ?? `Add ${title.toLowerCase()}`;
  return (
    <section className="sidebar-section">
      <div className="sidebar-label">
        <span>{title}</span>
        {action && !actionDisabledReason && (
          <button onClick={action} aria-label={label} title={label}>
            <Plus size={14} />
          </button>
        )}
        {actionDisabledReason && (
          <button disabled aria-label={`${label}: ${actionDisabledReason}`} title={actionDisabledReason}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
