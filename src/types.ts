export type Status = "online" | "thinking" | "offline" | "unknown";
export type Agent = {
  id: string;
  name: string;
  initials: string;
  role: string;
  color: string;
  status: Status;
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
  type: "dm" | "group";
  agentIds: string[];
  unread?: number;
  preview: string;
  time: string;
};
export type Message = {
  id: string;
  conversationId: string;
  author: string;
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
