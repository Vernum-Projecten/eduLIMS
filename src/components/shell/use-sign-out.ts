// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";

/**
 * Signs the user out and returns to the login page; a failure shows a toast. The Query cache
 * is emptied after, so nothing the user loaded stays in memory for the next person at a
 * shared lab computer.
 */
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const router = useRouter();
  const queryClient = useQueryClient();
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
    queryClient.clear();
  }

  return { signOut, pending };
}
