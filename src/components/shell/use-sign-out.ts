// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";

/**
 * Signs the user out; a failure shows a toast. The Query cache is emptied first, so nothing
 * the user loaded stays in memory for the next person at a shared lab computer. After an OIDC
 * sign-in whose provider offers RP-initiated logout, the browser then goes on to the
 * provider's end-session URL, which returns to the login page (ADR 0015); otherwise straight
 * to the login page.
 */
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const { data, error } = await authClient.signOut({
      fetchOptions: { body: { disableRedirect: true } },
    });
    if (error) {
      setPending(false);
      toast.error(m.sign_out_failed());
      return;
    }
    const url: unknown = data && "url" in data ? data.url : undefined;
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      queryClient.clear();
      window.location.assign(url);
      return;
    }
    setPending(false);
    await router.invalidate();
    await router.navigate({ to: "/login" });
    queryClient.clear();
  }

  return { signOut, pending };
}
