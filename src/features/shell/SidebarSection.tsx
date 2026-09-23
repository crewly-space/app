import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export function SidebarSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-label">
        <span>{title}</span>
        {action && (
          <button onClick={action} aria-label={`Add ${title.toLowerCase()}`}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
