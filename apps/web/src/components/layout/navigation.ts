import {
  KeyRound,
  ListVideo,
  Mic,
  Settings,
  Shield,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const navItems: NavItem[] = [
  {
    to: "/meetings",
    label: "Meetings",
    description: "Recordings, transcripts, and meeting status",
    icon: ListVideo,
  },
  {
    to: "/settings",
    label: "Settings",
    description: "API keys and integrations",
    icon: KeyRound,
  },
  {
    to: "/admin/users",
    label: "Users",
    description: "Accounts and roles",
    icon: Shield,
    adminOnly: true,
  },
  {
    to: "/admin/transcription",
    label: "Transcription",
    description: "Speech-to-text provider",
    icon: Mic,
    adminOnly: true,
  },
];

export function getVisibleNavItems(isAdmin: boolean) {
  return navItems.filter((item) => !item.adminOnly || isAdmin);
}

export function getPageMeta(pathname: string) {
  if (pathname.includes("/live")) {
    return {
      title: "Live View",
      description: "Monitor the session while the meeting is active.",
    };
  }
  if (pathname.startsWith("/meetings/")) {
    return {
      title: "Meeting Detail",
      description: "Recording, transcript, and session status.",
    };
  }

  const item = navItems
    .slice()
    .sort((a, b) => b.to.length - a.to.length)
    .find((navItem) => pathname.startsWith(navItem.to));

  return {
    title: item?.label ?? "OpenMinutes",
    description: item?.description ?? "Meeting workspace.",
  };
}
