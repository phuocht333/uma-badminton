import { useState } from "react";
import { useSubmit } from "@remix-run/react";
import { Button, type ButtonProps } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

interface Props {
  /** Form values posted on confirm — handler reads from request.formData(). */
  fields: Record<string, string | number>;
  /** Confirm dialog title. */
  title: string;
  /** Body copy explaining what will happen. */
  description: string;
  /** Text on the confirm button inside the dialog. */
  confirmLabel?: string;
  /** Visual style of the confirm button (variant of the trigger AND the modal confirm). */
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  /** Disabled state (e.g., during in-flight submission). */
  disabled?: boolean;
  /** Optional method (default POST). */
  method?: "post" | "delete";
  className?: string;
  /** Trigger label (the button the user actually sees). */
  children: React.ReactNode;
}

/**
 * Replaces inline `window.confirm()` + native `<Form>` patterns. The trigger
 * opens a styled dialog; only on confirm does the request actually fire.
 */
export function ConfirmForm({
  fields,
  title,
  description,
  confirmLabel = "Xác nhận",
  variant = "primary",
  size = "md",
  disabled,
  method = "post",
  className,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const submit = useSubmit();

  function handleConfirm() {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    submit(fd, { method });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant={variant} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Huỷ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
