import * as React from "react";
import { cn } from "~/lib/cn";

type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warn"
  | "error"
  | "info"
  | "muted";

const toneStyles: Record<BadgeTone, string> = {
  neutral: "bg-surface-strong text-body-strong",
  accent: "bg-accent-tint text-accent-deep",
  success: "bg-[#ECFDF5] text-[#047857]",
  warn: "bg-[#FFFBEB] text-[#B45309]",
  error: "bg-[#FEF2F2] text-[#B91C1C]",
  info: "bg-[#EFF6FF] text-[#1D4ED8]",
  muted: "bg-surface-strong text-muted",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
}

export function Badge({ className, tone = "neutral", mono = false, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-caption",
        mono && "font-mono uppercase tracking-wider text-label-mono",
        toneStyles[tone],
        className,
      )}
      {...props}
    />
  );
}
