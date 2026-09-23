/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where Crewly Cloud answers. Absent on a self-hosted build: no account, no rail. */
  readonly VITE_CREWLY_CLOUD_URL?: string;
  /** Where servers are created and billed, when that is not the app itself. */
  readonly VITE_CREWLY_DASHBOARD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
