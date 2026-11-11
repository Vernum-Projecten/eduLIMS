// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useRouter } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { authClient } from "@/lib/auth-client";
import type { Role } from "@/lib/roles";
import { hasRole, type SessionUser } from "@/server/authz";

const NAV_ITEMS = [
  { role: "student", to: "/student", label: m.portal_student },
  { role: "teacher", to: "/teacher", label: m.portal_teacher },
  { role: "admin", to: "/admin", label: m.portal_admin },
] as const satisfies readonly { role: Role; to: string; label: () => string }[];

export function SiteHeader({ user }: Readonly<{ user: SessionUser | null }>) {
  const items = NAV_ITEMS.filter((item) => hasRole(user, item.role));

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
        <Link to="/" className="font-semibold">
          eduLIMS
        </Link>
        {items.length > 0 && (
          <nav aria-label={m.main_menu()}>
            <ul className="flex flex-wrap gap-1">
              {items.map((item) => (
                <li key={item.to}>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={item.to} activeProps={{ "aria-current": "page" }}>
                      {item.label()}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <LocaleSwitcher />
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">{user.name}</span>
              <LogoutButton />
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/login">{m.sign_in()}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
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

  return (
    <Button variant="outline" size="sm" onClick={() => void logout()} disabled={pending}>
      <LogOutIcon aria-hidden="true" data-icon="inline-start" />
      {m.sign_out()}
    </Button>
  );
}
