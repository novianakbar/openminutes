import {
  KeyRound,
  FileAudio,
  ListVideo,
  Mic,
  Shield,
  Sparkles,
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
    to: "/summaries",
    label: "Summaries",
    description: "Upload audio, transcripts, and manual summaries",
    icon: FileAudio,
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
  {
    to: "/admin/summary",
    label: "AI Summary",
    description: "Summary model provider",
    icon: Sparkles,
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
  if (pathname.startsWith("/summaries/")) {
    return {
      title: "Summary Detail",
      description: "Audio, transcript, and generated summary.",
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
