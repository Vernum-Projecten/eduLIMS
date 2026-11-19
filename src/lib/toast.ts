// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The application's toast (#328): Sonner's, except that an error stays until it is closed.
import { toast as sonnerToast } from "sonner";

type ErrorToast = typeof sonnerToast.error;

/**
 * Sonner's `toast`, except that an error stays until the user closes it and has a close button:
 * a refusal must not vanish before it is read (WCAG 2.2.1, 3.3.1). Every other kind keeps
 * Sonner's timing. Import `toast` from here, never from `sonner`; the `Toaster` in
 * `src/components/ui/sonner.tsx` names the close button.
 */
export const toast: typeof sonnerToast = Object.assign(
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
