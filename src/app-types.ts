import type { AuthUser, DeviceInfo, DirectoryUser, UserAccount } from "@crewly/sdk";
import type { AvatarMode, ChannelCategory } from "@crewly/protocol";
import type { Agent, Approval, Conversation, Message, Provider } from "./types";

export type Bootstrap = {
  agents: Agent[];
  conversations: Conversation[];
  /** Sidebar sections that channels sit in; empty from a server before channels. */
  channelCategories: ChannelCategory[];
  messages: Message[];
  providers: Provider[];
  approvals: Approval[];
  devices: DeviceInfo[];
  currentUser: AuthUser;
  users: UserAccount[];
  /** Everyone's name and avatar; empty from a server older than the directory. */
  people: DirectoryUser[];
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
  kind: "agent" | "everyone" | "here" | "role";
  agent?: Agent;
};
