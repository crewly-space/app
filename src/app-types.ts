import type { AuthUser, DeviceInfo, DirectoryUser, ServerBranding, UserAccount } from "@crewly/sdk";
import type { AvatarMode, ChannelCategory } from "@crewly/protocol";
import type { Agent, Approval, Conversation, Message, Provider } from "./types";
import type { Connector } from "@crewly/sdk";

export type Bootstrap = {
  realtimeSeq?: number;
  historyErrors?: string[];
  agents: Agent[];
  conversations: Conversation[];
  /** Sidebar sections that channels sit in; empty from a server before channels. */
  channelCategories: ChannelCategory[];
  messages: Message[];
  providers: Provider[];
  connectors: Connector[];
  approvals: Approval[];
  devices: DeviceInfo[];
  currentUser: AuthUser;
  users: UserAccount[];
  /** Everyone's name and avatar; empty from a server older than the directory. */
  people: DirectoryUser[];
  /** Teammates' agents, drawn when they speak where the reader can see; not the reader's to manage. */
  otherAgents?: Agent[];
  serverBranding: ServerBranding;
};

export type Panel = "details" | "settings" | null;

export type Toast = { message: string; tone: "info" | "error" };

export type View = "messages" | "inbox" | "activity";

export type CreateAgentInput = Pick<Agent, "name" | "role" | "model" | "runtime"> & {
  providerId: string;
  memoryEnabled: boolean;
  workspace?: string;
  instructions?: string;
  avatarMode?: AvatarMode;
};

export type Theme = "system" | "light" | "dark";

export type MentionOption = {
  id: string;
  label: string;
  description: string;
  color: string;
  kind: "agent" | "user" | "everyone" | "here" | "role";
  agent?: Agent;
  person?: DirectoryUser;
};
