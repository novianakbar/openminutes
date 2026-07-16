import { NavLink, useLocation } from "react-router-dom";
import { AudioLines, LogOut, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";
import type { NavItem } from "./navigation";
import { getPageMeta } from "./navigation";

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("openminutes-theme", dark ? "dark" : "light");
  }, [dark]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? (
        <Sun className="h-5 w-5" aria-hidden />
      ) : (
        <Moon className="h-5 w-5" aria-hidden />
      )}
    </Button>
  );
}

export function Topbar({
  items,
  onLogout,
}: {
  items: NavItem[];
  onLogout: () => void;
}) {
  const location = useLocation();
  const meta = getPageMeta(location.pathname);

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-8">
        <div className="hidden min-w-0 md:block">
          <p className="truncate text-sm font-bold">{meta.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {meta.description}
          </p>
        </div>

        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <AudioLines className="h-5 w-5 shrink-0 text-accent" aria-hidden />
          <span className="truncate font-bold">OpenMinutes</span>
        </div>

        <div className="flex items-center gap-1">
          <nav className="flex items-center gap-1 md:hidden" aria-label="Primary">
            {items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-accent",
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                  )
                }
              >
                <Icon className="h-5 w-5" aria-hidden />
              </NavLink>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onLogout}
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" aria-hidden />
            </Button>
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
