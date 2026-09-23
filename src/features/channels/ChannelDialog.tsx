import { useState } from "react";
import { ArrowDown, ArrowUp, Ban, Hash, Lock, UserMinus, X } from "lucide-react";
import type { ChannelCategory, ChannelPostRole, ChannelVisibility } from "@crewly/protocol";
import type { DirectoryUser } from "@crewly/sdk";
import { gateway } from "../../lib/gateway";
import { useDialog } from "../../lib/layers";
import type { Agent, Conversation } from "../../types";
import { Avatar } from "../appearance/Avatar";

const NEW_CATEGORY = "__new__";

const POST_ROLES: { value: ChannelPostRole; label: string }[] = [
  { value: "member", label: "Every member" },
  { value: "admin", label: "Admins and the owner" },
  { value: "owner", label: "Only the owner" },
];

/**
 * Creates a channel, or shows and manages one.
 *
 * Everyone can see who is in a channel and leave it. Only admins can change
 * it, and the server enforces that whatever this dialog shows.
 */
export function ChannelDialog({
  channel,
  channels,
  categories,
  agents,
  people,
  canManage,
  onClose,
  onSaved,
  onLeft,
}: {
  /** The channel to manage; absent to create one. */
  channel?: Conversation;
  channels: Conversation[];
  categories: ChannelCategory[];
  agents: Agent[];
  people: DirectoryUser[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (channel: Conversation) => void;
  onLeft: (channelId: string) => void;
}) {
  const dialogRef = useDialog(onClose);
  const current = channel?.channel;
  const [name, setName] = useState(current?.name ?? "");
  const [topic, setTopic] = useState(current?.topic ?? "");
  const [visibility, setVisibility] = useState<ChannelVisibility>(current?.visibility ?? "public");
  const [postRole, setPostRole] = useState<ChannelPostRole>(current?.postRole ?? "member");
  const [categoryId, setCategoryId] = useState(current?.categoryId ?? "");
  const [newCategory, setNewCategory] = useState("");
  const [addingAgents, setAddingAgents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canManage;
  const title = current ? `#${current.name}` : "Create a channel";

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      return await action();
    } catch (reason) {
      setError(explain(reason));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function resolveCategory(): Promise<string | null> {
    if (categoryId !== NEW_CATEGORY) return categoryId || null;
    const created = await gateway.createChannelCategory(newCategory.trim());
    return created.id;
  }

  async function save() {
    const saved = await run(async () => {
      const category = await resolveCategory();
      const fields = { name, topic: topic.trim() || null, visibility, postRole, categoryId: category };
      if (!current) {
        return gateway.createChannel({ ...fields,
          members: addingAgents.map((participantId) => ({ participantId, participantType: "agent" as const })) });
      }
      return gateway.updateChannel(current.id, fields);
    });
    if (saved) onSaved(saved);
  }

  async function change(action: () => Promise<Conversation>) {
    const saved = await run(action);
    if (saved) onSaved(saved);
  }

  const memberAgents = current?.members.filter((m) => m.participantType === "agent").map((m) => m.participantId) ?? [];
  const memberPeople = current?.members.filter((m) => m.participantType === "user").map((m) => m.participantId) ?? [];
  const blocked = current?.blockedAgentIds ?? [];
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Removed agent";
  const personName = (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone";
  const invitableAgents = agents.filter((a) => !memberAgents.includes(a.id) && !blocked.includes(a.id));
  const invitablePeople = people.filter((p) => !memberPeople.includes(p.id));
  // Order is within the channel's own section, the one the sidebar shows it in.
  const siblings = channels
    .filter((c) => c.channel && !c.channel.archivedAt && (c.channel.categoryId ?? "") === (current?.categoryId ?? ""))
    .sort((a, b) => a.channel!.position - b.channel!.position);
  const index = siblings.findIndex((c) => c.id === current?.id);

  async function move(offset: number) {
    const ids = siblings.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + offset, 0, moved);
    await run(() => gateway.orderChannels(current?.categoryId ?? null, ids));
  }

  return (
    <div className="modal-layer" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <div ref={dialogRef} className="modal channel-modal" role="dialog" aria-modal="true" aria-labelledby="channel-dialog-title">
        <header>
          <div>
            <span className="eyebrow">{current ? (current.archivedAt ? "Archived channel" : "Channel") : "New channel"}</span>
            <h2 id="channel-dialog-title">{title}</h2>
            <p>
              {current
                ? current.topic || "Channels are shared rooms for people and agents on this server."
                : "A channel belongs to the server, not to whoever made it. People join public channels themselves."}
            </p>
          </div>
          <button type="button" className="icon-button compact" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <form
          id="channel-form"
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && editable) void save();
          }}
        >
          <label>
            <span>Name <em>Lower case, words joined by dashes</em></span>
            <input autoFocus={!current} required maxLength={80} spellCheck={false} disabled={!editable}
              value={name} onChange={(event) => setName(event.target.value)} placeholder="product-launch" />
          </label>
          <label>
            <span>Topic <em>Optional</em></span>
            <input maxLength={250} disabled={!editable} value={topic} onChange={(event) => setTopic(event.target.value)}
              placeholder="What this channel is for" />
          </label>
          <fieldset className="channel-visibility" disabled={!editable}>
            <legend>Who can find it</legend>
            <label className={visibility === "public" ? "selected" : ""}>
              <input type="radio" name="visibility" value="public" checked={visibility === "public"}
                onChange={() => setVisibility("public")} />
              <Hash size={16} />
              <span><strong>Public</strong><small>Anyone on the server can read and join it.</small></span>
            </label>
            <label className={visibility === "private" ? "selected" : ""}>
              <input type="radio" name="visibility" value="private" checked={visibility === "private"}
                onChange={() => setVisibility("private")} />
              <Lock size={16} />
              <span><strong>Private</strong><small>Only the people added to it can see it.</small></span>
            </label>
          </fieldset>
          <div className="simple-options">
            <label>
              <span>Who can post</span>
              <select value={postRole} disabled={!editable} onChange={(event) => setPostRole(event.target.value as ChannelPostRole)}>
                {POST_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </label>
            <label>
              <span>Section</span>
              <select value={categoryId} disabled={!editable} onChange={(event) => setCategoryId(event.target.value)}>
                <option value="">Channels</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                {editable && <option value={NEW_CATEGORY}>New section…</option>}
              </select>
            </label>
          </div>
          {categoryId === NEW_CATEGORY && (
            <label>
              <span>Section name</span>
              <input required maxLength={60} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
            </label>
          )}
          {!current && agents.length > 0 && (
            <fieldset className="channel-agents">
              <legend>Agents in the channel <em>They answer when mentioned</em></legend>
              {agents.map((agent) => (
                <label key={agent.id}>
                  <input type="checkbox" checked={addingAgents.includes(agent.id)} onChange={(event) =>
                    setAddingAgents((ids) => event.target.checked ? [...ids, agent.id] : ids.filter((id) => id !== agent.id))} />
                  <Avatar agent={agent} size="tiny" />
                  <span>{agent.name}</span>
                </label>
              ))}
            </fieldset>
          )}
        </form>

        {current && (
          <div className="channel-manage">
            <section>
              <h3>People <small>{memberPeople.length}</small></h3>
              <ul>
                {memberPeople.map((id) => (
                  <li key={id}>
                    <span>{personName(id)}</span>
                    {editable && (
                      <button type="button" className="icon-button compact" disabled={busy} aria-label={`Remove ${personName(id)}`}
                        onClick={() => void change(() => gateway.removeChannelMember(current.id, id, "user"))}>
                        <UserMinus size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {editable && invitablePeople.length > 0 && (
                <select aria-label="Add a person" value="" disabled={busy}
                  onChange={(event) => event.target.value && void change(() => gateway.addChannelMember(current.id, event.target.value, "user"))}>
                  <option value="">Add a person…</option>
                  {invitablePeople.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
                </select>
              )}
            </section>
            <section>
              <h3>Agents <small>{memberAgents.length}</small></h3>
              <ul>
                {memberAgents.map((id) => (
                  <li key={id}>
                    <Avatar agent={agents.find((a) => a.id === id)} size="tiny" />
                    <span>{agentName(id)}</span>
                    {editable && (
                      <>
                        <button type="button" className="icon-button compact" disabled={busy} aria-label={`Remove ${agentName(id)}`}
                          onClick={() => void change(() => gateway.removeChannelMember(current.id, id, "agent"))}>
                          <UserMinus size={15} />
                        </button>
                        <button type="button" className="icon-button compact" disabled={busy} aria-label={`Block ${agentName(id)}`}
                          title="Block: remove it and keep it out" onClick={() => void change(() => gateway.setChannelAgentBlocked(current.id, id, true))}>
                          <Ban size={15} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {editable && invitableAgents.length > 0 && (
                <select aria-label="Add an agent" value="" disabled={busy}
                  onChange={(event) => event.target.value && void change(() => gateway.addChannelMember(current.id, event.target.value, "agent"))}>
                  <option value="">Add an agent…</option>
                  {invitableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              )}
              {blocked.length > 0 && (
                <>
                  <h4>Blocked</h4>
                  <ul>
                    {blocked.map((id) => (
                      <li key={id} className="blocked">
                        <Ban size={14} />
                        <span>{agentName(id)}</span>
                        {editable && (
                          <button type="button" className="text-button" disabled={busy}
                            onClick={() => void change(() => gateway.setChannelAgentBlocked(current.id, id, false))}>Unblock</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            {editable && !current.archivedAt && siblings.length > 1 && (
              <section className="channel-order">
                <h3>Position <small>{index + 1} of {siblings.length}</small></h3>
                <div>
                  <button type="button" className="secondary-button compact" disabled={busy || index <= 0} onClick={() => void move(-1)}>
                    <ArrowUp size={14} /> Move up
                  </button>
                  <button type="button" className="secondary-button compact" disabled={busy || index >= siblings.length - 1} onClick={() => void move(1)}>
                    <ArrowDown size={14} /> Move down
                  </button>
                </div>
              </section>
            )}
          </div>
        )}

        {error && <div className="form-error channel-error" role="alert">{error}</div>}
        <footer>
          {current && current.joined && (
            <button type="button" className="secondary-button channel-footer-start" disabled={busy}
              onClick={async () => { if (await run(() => gateway.leaveChannel(current.id)) !== undefined) onLeft(current.id); }}>
              Leave channel
            </button>
          )}
          {current && editable && (
            <button type="button" className="danger-button" disabled={busy}
              onClick={() => void change(() => gateway.updateChannel(current.id, { archived: !current.archivedAt }))}>
              {current.archivedAt ? "Unarchive" : "Archive"}
            </button>
          )}
          {editable ? (
            <button type="submit" form="channel-form" className="primary-button" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : current ? "Save changes" : "Create channel"}
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onClose}>Done</button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** The SDK already turns the server's codes into sentences. */
function explain(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason)) || "Something went wrong.";
}
