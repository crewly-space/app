import type { LucideIcon } from "lucide-react";
import {
  Activity, BarChart3, Bot, Building2, Cloud, Cpu, KeyRound, Laptop, Mail, Network, Palette,
  Plug, ShieldCheck, Sparkles, UserRound, UserRoundPen, Wrench, Zap,
} from "lucide-react";

/**
 * Every setting in Crewly, in one place.
 *
 * There used to be a Settings dialog and a separate Server admin screen that
 * overlapped (both had providers, both had people) and looked nothing alike.
 * Now there is one Settings, and this list is its map: which sections exist,
 * where each sits, and who may open it. Navigation, deep links (/admin) and
 * permission checks all read from here, so they cannot disagree.
 */
export type SettingsSectionId =
  | "profile" | "appearance" | "devices"
  | "general" | "people" | "roles"
  | "providers" | "agents"
  | "connectors" | "tools" | "skills" | "secrets" | "mail" | "cloud" | "federation"
  | "usage" | "runs" | "automations";

export type SettingsAccess = "everyone" | "admin";

export type SettingsSection = {
  id: SettingsSectionId;
  label: string;
  /** One line under the section title: what lives here, in plain words. */
  summary: string;
  icon: LucideIcon;
  access: SettingsAccess;
};

export type SettingsGroup = {
  id: "account" | "server" | "ai" | "integrations" | "operations";
  label: string;
  sections: SettingsSection[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: "account", label: "Your account", sections: [
    { id: "profile", label: "Profile", summary: "Your name, the email you sign in with, and your password.", icon: UserRoundPen, access: "everyone" },
    { id: "appearance", label: "Appearance", summary: "Theme and how you appear to others.", icon: Palette, access: "everyone" },
    { id: "devices", label: "Devices", summary: "Computers that can run local agents for you.", icon: Laptop, access: "everyone" },
  ] },
  { id: "server", label: "Server", sections: [
    { id: "general", label: "General", summary: "Name, icon and health of this server.", icon: Building2, access: "admin" },
    { id: "people", label: "People", summary: "Who can sign in, what they may do, and invitations.", icon: UserRound, access: "admin" },
    { id: "roles", label: "Roles", summary: "Custom permission sets beyond owner, admin and member.", icon: ShieldCheck, access: "admin" },
  ] },
  { id: "ai", label: "AI", sections: [
    { id: "providers", label: "AI providers", summary: "Where agents get their models: Crewly Gateway, an API key or a subscription.", icon: Cpu, access: "everyone" },
    { id: "agents", label: "Agents", summary: "Runtime, tools and skills for each agent.", icon: Bot, access: "admin" },
  ] },
  { id: "integrations", label: "Integrations", sections: [
    { id: "connectors", label: "Connectors", summary: "Apps like GitHub, Linear and Slack, connected with OAuth.", icon: Plug, access: "admin" },
    { id: "tools", label: "MCP tools", summary: "MCP servers, from the catalog or your own, whose tools agents can call.", icon: Wrench, access: "admin" },
    { id: "skills", label: "Skills", summary: "Reusable instructions agents can load.", icon: Sparkles, access: "admin" },
    { id: "secrets", label: "Secrets", summary: "Encrypted values tools and agents can use without seeing them.", icon: KeyRound, access: "admin" },
    { id: "mail", label: "Email", summary: "Sending domains and outbound email.", icon: Mail, access: "admin" },
    { id: "cloud", label: "Crewly Cloud", summary: "Link this server to your Crewly account for mail, Gateway and sign-in.", icon: Cloud, access: "admin" },
    { id: "federation", label: "Federation", summary: "Mutual, scoped connections with other Crewly servers.", icon: Network, access: "admin" },
  ] },
  { id: "operations", label: "Operations", sections: [
    { id: "usage", label: "Usage", summary: "Tokens and spend by agent and provider.", icon: BarChart3, access: "admin" },
    { id: "runs", label: "Runs", summary: "What agents did, step by step.", icon: Activity, access: "admin" },
    { id: "automations", label: "Automations", summary: "Schedules and webhooks that start agent work.", icon: Zap, access: "admin" },
  ] },
];

export const ALL_SECTIONS: SettingsSection[] = SETTINGS_GROUPS.flatMap((group) => group.sections);

export function canOpen(section: SettingsSection, role: string): boolean {
  return section.access === "everyone" || role === "owner" || role === "admin";
}

/** The groups this person may see, with empty groups left out. */
export function visibleGroups(role: string): SettingsGroup[] {
  return SETTINGS_GROUPS
    .map((group) => ({ ...group, sections: group.sections.filter((section) => canOpen(section, role)) }))
    .filter((group) => group.sections.length > 0);
}

export function findSection(id: string | null | undefined): SettingsSection | undefined {
  return ALL_SECTIONS.find((section) => section.id === id);
}
