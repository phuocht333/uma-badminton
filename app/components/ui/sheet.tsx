import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "~/lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-ink/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: "right" | "left" | "bottom" | "top";
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = "right", ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col gap-4 border border-hairline bg-surface-card shadow-drop-modal transition-transform",
        // Default width grows with viewport so the sheet feels proportional.
        // Mobile = full width; tablet = ~32rem; desktop = ~36rem; large desktop = ~42rem.
        side === "right" &&
          "right-0 top-0 h-full w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl data-[state=closed]:translate-x-full",
        side === "left" &&
          "left-0 top-0 h-full w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl data-[state=closed]:-translate-x-full",
        side === "bottom" &&
          "bottom-0 left-0 right-0 max-h-[90vh] data-[state=closed]:translate-y-full",
        side === "top" && "left-0 right-0 top-0 max-h-[90vh] data-[state=closed]:-translate-y-full",
        className,
      )}
      {...props}
    >
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-sm text-muted transition hover:text-ink focus-visible:outline-none focus-visible:shadow-glow-accent"
        aria-label="Đóng"
      >
        <X className="h-5 w-5" />
      </DialogPrimitive.Close>
      {children}
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 px-6 pt-6", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

export const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex-1 overflow-y-auto px-6 pb-6", className)} {...props} />
);
SheetBody.displayName = "SheetBody";

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title-md text-ink", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body-sm text-muted", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";
