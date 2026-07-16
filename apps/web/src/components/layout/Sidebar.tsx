import { NavLink } from "react-router-dom";
import { AudioLines, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import type { NavItem } from "./navigation";

interface SidebarUser {
  name?: string | null;
  email?: string | null;
}

function navLinkClass(isCollapsed: boolean, isActive: boolean) {
  return cn(
    "flex h-11 items-center rounded-lg text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent",
    isCollapsed ? "justify-center px-0" : "gap-3 px-3",
    isActive
      ? "bg-accent/10 text-accent"
      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
  );
}

export function Sidebar({
  collapsed,
  items,
  user,
  onToggle,
  onLogout,
}: {
  collapsed: boolean;
  items: NavItem[];
  user: SidebarUser;
  onToggle: () => void;
  onLogout: () => void;
}) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-border bg-surface transition-[width] duration-200 md:flex",
        collapsed ? "w-20" : "w-64",
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-border px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <AudioLines className="h-5 w-5" aria-hidden />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-base font-bold tracking-tight">OpenMinutes</p>
            <p className="truncate text-xs text-muted-foreground">
              Meeting workspace
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-3">
        {!collapsed && (
          <p className="px-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Workspace
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Minimize sidebar"}
          className="ml-auto h-9 w-9"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Primary">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={collapsed ? label : undefined}
            title={collapsed ? label : undefined}
            className={({ isActive }) => navLinkClass(collapsed, isActive)}
          >
            <Icon className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div
          className={cn(
            "flex items-center rounded-xl bg-background",
            collapsed ? "justify-center p-2" : "gap-3 p-3",
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-sm font-bold text-accent">
            {user.name?.slice(0, 1).toUpperCase() ?? user.email?.slice(0, 1).toUpperCase() ?? "U"}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onLogout}
                aria-label="Sign out"
                className="h-9 w-9 shrink-0"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
        {collapsed && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onLogout}
            aria-label="Sign out"
            className="mt-2 h-9 w-full"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </aside>
  );
}
