import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import { m } from "@/i18n/messages";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={m.loading()}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
