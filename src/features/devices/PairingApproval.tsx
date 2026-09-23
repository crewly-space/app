import { useEffect, useState } from "react";
import type { DevicePairingInfo } from "@crewly/sdk";
import { Laptop, LockKeyhole } from "lucide-react";
import { gateway } from "../../lib/gateway";

export function PairingApproval({ code, onApproved }: { code: string; onApproved: () => Promise<void> }) {
  const [pairing, setPairing] = useState<DevicePairingInfo | null>(null);
  const [error, setError] = useState("");
  const [approving, setApproving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void gateway.findDevicePairing(code).then((result) => {
      if (!cancelled) setPairing(result);
    }).catch(() => {
      if (!cancelled) setError("This pairing code is invalid or has expired.");
    });
    return () => { cancelled = true; };
  }, [code]);
  return <div className="onboarding"><div className="onboarding-body"><div className="onboarding-card pairing-card">
    <div className="device-illustration"><Laptop size={24} /></div>
    <h1>Pair this device?</h1>
    {error ? <p role="alert">{error}</p> : !pairing ? <p>Checking pairing code…</p> : <>
      <p><strong>{pairing.deviceName}</strong> wants to connect to this Crewly server.</p>
      <p className="muted-copy">{pairing.platform ?? "Unknown platform"} · Code {code.toUpperCase()}</p>
      <div className="security-note"><LockKeyhole size={15} /><span>Only approve a device you recognize. Its private key never leaves that computer.</span></div>
      <div className="pairing-actions">
        <button className="primary-button" disabled={approving} onClick={async () => {
          setApproving(true); setError("");
          try { await gateway.approveDevicePairing(code); await onApproved(); }
          catch { setError("Could not approve this device. Request a new pairing code and try again."); setApproving(false); }
        }}>{approving ? "Approving…" : "Approve device"}</button>
        {/* A screen that asks you to recognise a device has to let you say no.
            Closing the tab was the only refusal available. */}
        <button className="secondary-button" disabled={approving} onClick={() => {
          window.history.replaceState(null, "", window.location.pathname);
          window.location.reload();
        }}>Not this device</button>
      </div>
    </>}
  </div></div></div>;

}
