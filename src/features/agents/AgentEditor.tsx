import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "@crewly/protocol";
import { Check, ChevronDown, Settings, Sparkles, X } from "lucide-react";
import { ModelPicker } from "./ModelPicker";
import { ProviderConnect } from "../providers/ProviderConnect";
import { providerConnectionLabel } from "../providers/labels";
import { useDialog } from "../../lib/layers";
import type { Agent, Provider } from "../../types";
import type { CreateAgentInput } from "../../app-types";
import { Avatar, AvatarModePicker } from "../appearance/Avatar";
import type { AvatarMode } from "@crewly/protocol";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  "openai-compatible": "Custom provider",
  "crewly-gateway": "Crewly Gateway",
  "claude-subscription": "Claude subscription",
  ollama: "Ollama",
};

function providerLabel(provider: Provider): string {
  const label = PROVIDER_LABELS[provider.name] ?? provider.name;
  return provider.id === provider.name ? label : `${label} · ${provider.id}`;
}

export function AgentEditor({
  providers,
  agent,
  firstRun,
  onClose,
  onSubmit,
  loadModels,
  onProvidersChanged,
}: {
  agent?: Agent;
  providers: Provider[];
  /** First run: this dialog is the whole screen; closing it skips the step. */
  firstRun?: boolean;
  onClose: () => void;
  onSubmit: (agent: CreateAgentInput) => Promise<void>;
  /** The provider's model list. Injected so a test needs no provider behind it. */
  loadModels?: (providerId: string) => Promise<ModelInfo[]>;
  /**
   * Reloads the provider list after one is connected from inside this
   * dialog. Given only to people who may connect providers.
   */
  onProvidersChanged?: () => Promise<unknown>;
}) {
  const dialogRef = useDialog(onClose);
  const [name, setName] = useState(agent?.name ?? "");
  const [role, setRole] = useState(agent?.role ?? "");
  const [advanced, setAdvanced] = useState(
    Boolean(agent?.workspace || agent?.instructions),
  );
  const [model, setModel] = useState(agent?.model ?? "");
  // The select below lists only connected providers, so the default has to come from the same list.
  const connectedProviders = providers.filter((p) => p.status === 'connected');
  const [providerId, setProviderId] = useState(agent?.providerId ?? connectedProviders[0]?.id ?? "");
  // A provider connected while this is open -- from Settings, or a device
  // coming online -- becomes the choice, rather than leaving the editor
  // stuck on "connect a provider first" until it is closed and reopened.
  const firstConnected = connectedProviders[0]?.id;
  useEffect(() => {
    if (!providerId && firstConnected) setProviderId(firstConnected);
  }, [providerId, firstConnected]);
  const [runtime, setRuntime] = useState(agent?.runtime ?? "Chat");
  const [workspace, setWorkspace] = useState(agent?.workspace ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [memoryEnabled, setMemoryEnabled] = useState(
    agent?.memoryEnabled !== false,
  );
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(agent?.avatarMode ?? "bloop");
  const [saving, setSaving] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(agent);
  const templates = [
    ["Product", "Product strategist", "Turn ambiguous ideas into concise plans, tradeoffs, and next steps."],
    ["Engineering", "Staff engineer", "Work carefully, explain important decisions, and verify changes."],
    ["Research", "Research partner", "Find reliable evidence and distinguish facts from inference."],
  ] as const;
  const previewAgent: Agent = {
    id: agent?.id ?? "agent-preview",
    name: name.trim() || "New agent",
    avatarMode,
    initials: (name.trim().charAt(0) || "N").toUpperCase(),
    role: role.trim() || "Add a clear role",
    color: agent?.color ?? "#7857d8",
    status: agent?.status ?? "online",
    model,
    providerId,
    runtime,
    workspace: workspace || undefined,
    memory: agent?.memory ?? [],
    memoryEnabled,
    instructions,
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) { nameRef.current?.focus(); return; }
    if (!role.trim()) { roleRef.current?.focus(); return; }
    // The provider comes first: without one there is no model list to choose
    // from, so asking for a model would be asking for something impossible.
    if (!providerId) {
      setError("Connect a provider before creating an agent.");
      return;
    }
    if (!model.trim()) {
      setError("Choose a model for this agent.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit({
        name: name.trim(),
        role: role.trim(),
        model: model.trim(),
        providerId,
        runtime,
        memoryEnabled,
        avatarMode,
        workspace: runtime === "Chat" ? undefined : workspace || undefined,
        instructions: instructions.trim() || undefined,
      });
    } catch {
      setError(`The agent could not be ${editing ? "updated" : "created"}. Check the provider and model ID.`);
      setSaving(false);
    }
  }
  return (
    <div
      className={`modal-layer${firstRun ? " modal-layer-plain" : ""}`}
      onMouseDown={(event) => {
        if (!firstRun && event.currentTarget === event.target) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal agent-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-editor-title"
      >
        <header>
          <div>
            <span className="eyebrow">{editing ? "Agent settings" : "New teammate"}</span>
            <h2 id="agent-editor-title">{editing ? `Edit ${agent?.name}` : "Create an agent"}</h2>
            <p>{editing ? "Changes apply everywhere this agent appears." : "Choose a clear role now. Fine-tune the rest whenever you need."}</p>
          </div>
          {!firstRun && <button
            className="icon-button compact"
            onClick={onClose}
            aria-label={editing ? "Close agent editor" : "Close agent creation"}
          >
            <X size={18} />
          </button>}
        </header>
        <form id="agent-editor-form" className="form agent-form" onSubmit={submit}>
          <div className="agent-draft-card">
            <Avatar agent={previewAgent} size="large" />
            <div>
              <strong>{previewAgent.name}</strong>
              <span>{previewAgent.role}</span>
            </div>
            <small>{model}</small>
          </div>
          {!editing && (
            <div className="template-picker">
              <span>Start with a role</span>
              <div>
                {templates.map(([label, templateRole, templateInstructions]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      setRole(templateRole);
                      setInstructions(templateInstructions);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="form-section-label">Identity</div>
          <label>
            <span>Name <em>Required</em></span>
            <input
              ref={nameRef}
              autoFocus
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={48}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Maya"
            />
          </label>
          <label>
            <span>Role <em>Required</em></span>
            <input
              ref={roleRef}
              required
              autoComplete="off"
              maxLength={72}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="e.g. Product strategist"
            />
            <small className="field-description">A short title people will recognize in conversations.</small>
          </label>
          <AvatarModePicker
            name="agent-avatar"
            legend="Avatar"
            value={avatarMode}
            onChange={setAvatarMode}
            preview={(mode) => <Avatar agent={previewAgent} mode={mode} />}
          />
          <div className="form-section-label">How this agent works</div>
          <div className="simple-options">
            <label>Provider<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
              {connectedProviders.map((p) => <option key={p.id} value={p.id}>{providerLabel(p)}</option>)}
            </select></label>
            <ModelPicker providerId={providerId} value={model} onChange={setModel} loadModels={loadModels} />
          </div>
          {!connectedProviders.length && (
            <div className="agent-editor-no-provider" role="status">
              <span>An agent needs a model to think with. No provider is connected yet.</span>
              {onProvidersChanged
                ? <button type="button" className="secondary-button" onClick={() => setConnectingProvider(true)}>Connect a provider</button>
                : <span>Ask an admin to connect one.</span>}
            </div>
          )}
          {connectedProviders.length > 0 && onProvidersChanged && (
            <button type="button" className="text-button" onClick={() => setConnectingProvider(true)}>Connect another provider</button>
          )}
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronDown size={16} className={advanced ? "rotated" : ""} />{" "}
            Advanced options
          </button>
          {advanced && (
            <div className="advanced-options">
              <label>
                Working instructions
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  placeholder="Priorities, working style, and boundaries…"
                />
              </label>
            </div>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
        </form>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>
            {firstRun ? "Skip for now" : "Cancel"}
          </button>
          <button
            type="submit"
            form="agent-editor-form"
            className="primary-button"
            // Nothing to run it on: say so up front instead of failing on submit.
            disabled={saving || (!editing && !connectedProviders.length)}
          >
            {saving
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
                ? "Save changes"
                : "Create agent"}
            {editing ? <Check size={16} /> : <Sparkles size={16} />}
          </button>
        </footer>
      </div>
      {connectingProvider && onProvidersChanged && (
        // Straight back here once connected: the new provider becomes the
        // choice and its models load, with no detour through Settings.
        <div className="provider-connect-layer">
          <ProviderConnect
            onClose={() => setConnectingProvider(false)}
            onConnected={() => { void onProvidersChanged().finally(() => setConnectingProvider(false)); }}
          />
        </div>
      )}
    </div>
  );
}
