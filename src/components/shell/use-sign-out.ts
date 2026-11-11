// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";

/** Signs the user out and returns to the login page; a failure shows a toast. */
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const { error } = await authClient.signOut();
    setPending(false);
    if (error) {
      toast.error(m.sign_out_failed());
      return;
    }
    await router.invalidate();
    await router.navigate({ to: "/login" });
  }

  return { signOut, pending };
}
