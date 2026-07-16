import { useEffect, useState } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { authClient } from "../lib/auth";
import { cn } from "../lib/cn";
import { Sidebar } from "./layout/Sidebar";
import { Topbar } from "./layout/Topbar";
import { getVisibleNavItems } from "./layout/navigation";

const SIDEBAR_KEY = "openminutes-sidebar-collapsed";

export function Layout() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed));
  }, [collapsed]);

  if (isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <LoaderCircle
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label="Loading session"
        />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;

  const isAdmin = session.user.role === "admin";
  const items = getVisibleNavItems(isAdmin);

  async function handleLogout() {
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar
        collapsed={collapsed}
        items={items}
        user={session.user}
        onToggle={() => setCollapsed((value) => !value)}
        onLogout={handleLogout}
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200",
          collapsed ? "md:pl-20" : "md:pl-64",
        )}
      >
        <Topbar items={items} onLogout={handleLogout} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
