import type { DeviceInfo } from '@crewly/sdk';

/*
 * Which subscription- and device-backed providers can be connected, and if
 * not, exactly what is missing.
 *
 * These providers never hand the server a credential: the model runs through
 * a paired device that is already signed in, so availability can only come
 * from what that device reports in its heartbeat -- the runtimes it found and
 * the providers it has enabled. Nothing here is a guess dressed up as an
 * option; an unavailable one says why, in terms the person can act on.
 *
 * Coding runtimes (Claude Code, Codex) are reported beside providers but are
 * not providers: an installed Codex does not make a ChatGPT provider.
 */

export type DeviceProviderKind = 'claude-subscription' | 'ollama';

export type Availability =
  | { state: 'ready'; deviceName: string }
  | { state: 'no_device' }
  | { state: 'device_offline'; deviceName: string }
  | { state: 'runtime_missing'; deviceName: string }
  | { state: 'signed_out'; deviceName: string }
  | { state: 'not_enabled'; deviceName: string };

type Entry = { id?: unknown; kind?: unknown; authenticated?: unknown };

function entries(device: DeviceInfo, key: 'providers' | 'runtimes'): Entry[] {
  const list = (device.capabilities as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(list) ? list.filter((item): item is Entry => Boolean(item) && typeof item === 'object') : [];
}

const enabled = (device: DeviceInfo, kind: DeviceProviderKind) =>
  entries(device, 'providers').some((provider) => provider.kind === kind);

/**
 * The best a set of devices can offer for one kind.
 *
 * States are ranked by how close they are to working, so one ready laptop
 * wins over an offline desktop, and the reason given for an unavailable kind
 * is the one nearest to being fixed.
 */
export function deviceProviderAvailability(devices: DeviceInfo[], kind: DeviceProviderKind): Availability {
  if (devices.length === 0) return { state: 'no_device' };
  const rank: Availability['state'][] = ['ready', 'not_enabled', 'signed_out', 'runtime_missing', 'device_offline'];
  let best: Availability | null = null;
  for (const device of devices) {
    const deviceName = device.name;
    let candidate: Availability;
    if (!device.connected) {
      candidate = { state: 'device_offline', deviceName };
    } else if (enabled(device, kind)) {
      candidate = { state: 'ready', deviceName };
    } else if (kind === 'ollama') {
      // Ollama has no sign-in to detect; the device either offers it or not.
      candidate = { state: 'not_enabled', deviceName };
    } else {
      const runtime = entries(device, 'runtimes').find((item) => item.id === kind);
      candidate = !runtime
        ? { state: 'runtime_missing', deviceName }
        : runtime.authenticated === true
          ? { state: 'not_enabled', deviceName }
          : { state: 'signed_out', deviceName };
    }
    if (!best || rank.indexOf(candidate.state) < rank.indexOf(best.state)) best = candidate;
  }
  return best!;
}

/** Whether any connected device has Codex signed in -- a runtime, shown as such. */
export function codexRuntimeOn(devices: DeviceInfo[]): string | null {
  const device = devices.find((candidate) => candidate.connected
    && entries(candidate, 'runtimes').some((runtime) => runtime.id === 'codex' && runtime.authenticated === true));
  return device?.name ?? null;
}

/**
 * Whether connecting from the app can make this work now. A device that is
 * signed in but has not enabled the provider counts: connecting asks it to.
 */
export function connectable(availability: Availability): boolean {
  return availability.state === 'ready' || availability.state === 'not_enabled';
}

/** What a device said when asked to switch a provider on, in words. */
export function explainRefusal(kind: DeviceProviderKind, deviceName: string, code: string | undefined): string {
  switch (code) {
    case 'provider_sign_in_expired':
      return `Claude Code on ${deviceName} isn't signed in. Run claude login there, then connect again.`;
    case 'runtime_missing':
      return `Claude Code isn't installed on ${deviceName}. Install it, then connect again.`;
    case 'device_unavailable':
      return `${deviceName} didn't answer. Check crewly is running on it, then connect again.`;
    default:
      return kind === 'ollama'
        ? `${deviceName} couldn't reach Ollama. Start Ollama there, then connect again.`
        : `${deviceName} couldn't switch Claude on. Try again in a moment.`;
  }
}

/** What to tell someone about an availability, and what they can do next. */
export function explain(kind: DeviceProviderKind, availability: Availability): string {
  const product = kind === 'claude-subscription' ? 'your Claude subscription' : 'Ollama';
  switch (availability.state) {
    case 'ready':
      return `Runs on ${availability.deviceName}. No key leaves the device.`;
    case 'no_device':
      return `Pair a device in Settings → Devices to use ${product}.`;
    case 'device_offline':
      return `${availability.deviceName} is offline. Start crewly on it to use ${product}.`;
    case 'runtime_missing':
      return `Claude Code isn't installed on ${availability.deviceName}. Install it, then run claude login.`;
    case 'signed_out':
      return `Claude Code on ${availability.deviceName} isn't signed in. Run claude login there.`;
    case 'not_enabled':
      return kind === 'ollama'
        ? `Connecting asks ${availability.deviceName} to use its Ollama.`
        : `Signed in on ${availability.deviceName}. Connecting switches it on there; no key leaves the device.`;
  }
}
