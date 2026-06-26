import * as React from "react";
import { cn } from "~/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex h-11 w-full rounded-md border border-hairline-strong bg-canvas-soft px-3 text-body-md text-ink placeholder:text-muted-soft",
          "transition focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-glow-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "file:border-0 file:bg-transparent file:text-body-sm file:font-medium file:mr-3",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
