import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn";

type AlertTone = "info" | "warning" | "danger" | "success";

const toneClass: Record<AlertTone, string> = {
  info: "border-info/30 bg-info/10 text-info",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  success: "border-accent/30 bg-accent/10 text-accent",
};

const Icon = {
  info: Info,
  warning: TriangleAlert,
  danger: AlertCircle,
  success: CheckCircle2,
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const AlertIcon = Icon[tone];
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-sm",
        toneClass[tone],
        className,
      )}
    >
      <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title ? "mt-0.5" : undefined, "text-muted-foreground")}>
          {children}
        </div>
      </div>
    </div>
  );
}
