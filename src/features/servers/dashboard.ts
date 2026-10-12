const cloudUrl: string | undefined = import.meta.env.VITE_CREWLY_CLOUD_URL;

/**
 * The account's dashboard -- workspaces, billing, servers -- when hosted.
 *
 * Cloud serves it at /dashboard/ on its own origin, so a hosted build that
 * forgot the variable still gets the link instead of quietly losing it.
 */
export const dashboardUrl: string | undefined = import.meta.env.VITE_CREWLY_DASHBOARD_URL
  || (cloudUrl ? `${cloudUrl.replace(/\/+$/, '')}/dashboard/` : undefined);
