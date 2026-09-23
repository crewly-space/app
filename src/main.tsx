import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./features/auth/AuthGate";
import { CloudGate } from "./features/servers/CloudGate";
import { cloudUrl } from "./features/servers/useServerRegistry";
import { CloudAccount } from "./lib/cloud/account";
// Brand faces ship with @crewly/ui and are pulled in by styles.css.
import "./styles.css";

// Built with a Cloud URL, the app is the hosted client: the person signs in to
// their Crewly account and opens a server it owns. Without one it is served by
// a single server and logs in to that server, as a self-hosted install does.
const gated = cloudUrl
  ? <CloudGate account={new CloudAccount(cloudUrl)} cloudUrl={cloudUrl}><App /></CloudGate>
  : <AuthGate><App /></AuthGate>;

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode>{gated}</React.StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
}
