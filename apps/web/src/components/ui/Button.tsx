import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-hover focus-visible:outline-accent",
  secondary:
    "border border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:outline-accent",
  ghost:
    "text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-accent",
  danger:
    "border border-destructive/40 text-destructive hover:bg-destructive/10 focus-visible:outline-destructive",
  outline:
    "border border-border bg-background text-foreground hover:bg-surface-hover focus-visible:outline-accent",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-4 text-sm",
  icon: "h-10 w-10 p-0",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-semibold transition-colors duration-200 disabled:cursor-default disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2",
    variantClass[variant],
    sizeClass[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <button {...props} className={buttonClass({ variant, size, className })}>
      {children}
    </button>
  );
}
