// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link, useRouter } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { Role } from "@/lib/roles";
import { hasRole, type SessionUser } from "@/server/authz";

const NAV_ITEMS = [
  { role: "student", to: "/student", label: "Studentportaal" },
  { role: "docent", to: "/docent", label: "Docentportaal" },
  { role: "beheerder", to: "/beheer", label: "Beheerportaal" },
] as const satisfies readonly { role: Role; to: string; label: string }[];

export function SiteHeader({ user }: Readonly<{ user: SessionUser | null }>) {
  const items = NAV_ITEMS.filter((item) => hasRole(user, item.role));

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
        <Link to="/" className="font-semibold">
          eduLIMS
        </Link>
        {items.length > 0 && (
          <nav aria-label="Hoofdmenu">
            <ul className="flex flex-wrap gap-1">
              {items.map((item) => (
                <li key={item.to}>
                  <Button asChild variant="ghost" size="sm">
                    <Link to={item.to} activeProps={{ "aria-current": "page" }}>
                      {item.label}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm text-muted-foreground">{user.name}</span>
              <LogoutButton />
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/login">Inloggen</Link>
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
      toast.error("Uitloggen is mislukt. Probeer het opnieuw.");
      return;
    }
    await router.invalidate();
    await router.navigate({ to: "/login" });
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void logout()} disabled={pending}>
      <LogOutIcon aria-hidden="true" data-icon="inline-start" />
      Uitloggen
    </Button>
  );
}
