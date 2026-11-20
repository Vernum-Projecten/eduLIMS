import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/theme/theme-provider";
import { m } from "@/i18n/messages";

// Adapted from the shadcn/ui registry: the theme comes from the app's ThemeProvider, not next-themes.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      // A menu or a popover opens above the toasts (Radix uses z-50): an open menu item stays
      // reachable by pointer while a toast shows (UI review of #394). Sonner's own z-index is
      // unlayered CSS, so the utility needs `!` to win.
      className="toaster group z-40!"
      containerAriaLabel={m.ui_notifications()}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
        closeButtonAriaLabel: m.ui_close(),
      }}
      {...props}
    />
  );
};

export { Toaster };
