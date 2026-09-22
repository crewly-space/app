/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where Crewly Cloud answers. Absent on a self-hosted build: no account, no rail. */
  readonly VITE_CREWLY_CLOUD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
