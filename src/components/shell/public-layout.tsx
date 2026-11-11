// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { LogOutIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageMenu } from "@/components/language-menu";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { useSignOut } from "@/components/shell/use-sign-out";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

/** The brand link: the mark beside the name, which gives the link its accessible name. */
export function BrandLink({ className }: Readonly<{ className?: string }>) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2 rounded-md text-lg tracking-tight", className)}
    >
      <BrandMark />
      <span>
        edu<span className="font-bold text-primary">LIMS</span>
      </span>
    </Link>
  );
}

/** The theme and language menus, top right on every page outside the portals. */
export function DisplayMenus({ signedIn }: Readonly<{ signedIn: boolean }>) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ThemeMenu />
      <LanguageMenu signedIn={signedIn} />
    </div>
  );
}

/** Signing out for a signed-in user outside the portals (an account without a role). */
function SignOutButton() {
  const { signOut, pending } = useSignOut();
  return (
    <Button variant="outline" size="sm" onClick={() => void signOut()} disabled={pending}>
      <LogOutIcon aria-hidden="true" data-icon="inline-start" />
      {m.sign_out()}
    </Button>
  );
}

/**
 * The layout for visitors who are not signed in (the home page, a missing page): a header with
 * the brand, the display menus and the sign-in link, and the page centred in `main`.
 */
export function PublicLayout({
  signedIn,
  children,
}: Readonly<{ signedIn: boolean; children: ReactNode }>) {
  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <BrandLink />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DisplayMenus signedIn={signedIn} />
            {signedIn ? (
              <SignOutButton />
            ) : (
              <Button asChild size="sm">
                <Link to="/login">{m.sign_in()}</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 outline-none md:py-12"
      >
        {children}
      </main>
    </div>
  );
}
