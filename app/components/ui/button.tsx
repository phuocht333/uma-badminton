import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium text-button transition-colors focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Primary: ink button (one per band). Accent CTA is reserved for the
        // single most-important action on a screen.
        primary:
          "rounded-md bg-ink text-on-ink hover:bg-ink-soft focus-visible:shadow-[0_0_0_4px_rgba(10,10,10,0.18)]",
        accent:
          "rounded-md bg-accent text-accent-on hover:bg-accent-deep focus-visible:shadow-glow-accent",
        outline:
          "rounded-md border border-hairline-strong bg-canvas-soft text-ink hover:bg-surface-strong focus-visible:shadow-glow-accent",
        ghost:
          "rounded-md text-ink hover:bg-surface-strong focus-visible:shadow-glow-accent",
        destructive:
          "rounded-md bg-semantic-error text-on-ink hover:bg-red-700 focus-visible:shadow-[0_0_0_4px_rgba(220,38,38,0.3)]",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        xl: "h-12 px-6 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";
