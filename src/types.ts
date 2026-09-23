import type { AvatarMode, Channel } from "@crewly/protocol";

export type Status = "online" | "thinking" | "offline" | "unknown";
export type Agent = {
  id: string;
  name: string;
  /** How the agent is drawn, chosen by its owner; the same for everyone. */
  avatarMode?: AvatarMode;
  initials: string;
  role: string;
  color: string;
  status: Status;
  /** The server's canonical status, when it reports one. */
  presence?: "online" | "idle" | "dnd" | "offline";
  execution?: "ready" | "working" | "waiting_approval" | "queued" | "error" | "runtime_unavailable" | "provider_unavailable";
  statusReason?: string;
  availability?: "auto" | "dnd";
  activeRunId?: string;
  model: string;
  providerId?: string;
  runtime: string;
  workspace?: string;
  instructions?: string;
  memoryEnabled?: boolean;
  memory: string[];
};
export type Conversation = {
  id: string;
  name: string;
  type: "dm" | "group" | "channel";
  agentIds: string[];
  /** Set for a channel: who is in it, who may post, where it sits in the sidebar. */
  channel?: Channel;
  unread?: number;
  preview: string;
  time: string;
};
export type Message = {
  id: string;
  conversationId: string;
  author: string;
  /** The person who wrote it, when a person did: seeds their avatar. */
  userId?: string;
  body: string;
  time: string;
  replyTo?: string;
  streaming?: boolean;
  activity?: { label: string; detail: string; state: "running" | "done" };
};
export type Approval = {
  id: string;
  conversationId: string;
  agentId: string;
  capability: string;
  description: string;
  workspace: string;
  requestedAt: string;
  expiresIn: string;
};
export type Provider = {
  id: string;
  name: string;
  detail: string;
  status: "connected" | "available" | "missing";
  local?: boolean;
};
