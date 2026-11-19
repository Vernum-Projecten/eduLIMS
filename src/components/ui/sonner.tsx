import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, toast as sonnerToast, type ToasterProps } from "sonner";
import { useTheme } from "@/components/theme/theme-provider";
import { m } from "@/i18n/messages";

// Adapted from the shadcn/ui registry: the theme comes from the app's ThemeProvider, not next-themes.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
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

type ErrorToast = typeof sonnerToast.error;

/**
 * Sonner's `toast`, except that an error stays until the user closes it and has a close button:
 * a refusal must not vanish before it is read (WCAG 2.2.1, 3.3.1). Every other kind keeps
 * Sonner's timing. Import `toast` from here, never from `sonner`.
 */
const toast: typeof sonnerToast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  {
    error: ((message, data) =>
      sonnerToast.error(message, {
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
        ...data,
      })) satisfies ErrorToast,
  },
);

export { Toaster, toast };
