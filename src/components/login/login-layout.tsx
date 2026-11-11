// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { BrandPanel } from "@/components/login/brand-panel";
import { LoginHeading } from "@/components/login/login-form";
import { BrandLink, DisplayMenus } from "@/components/shell/public-layout";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/i18n/messages";
import { cn } from "@/lib/utils";

/**
 * The frame of the login page (the login-02 block): the header and the content on one side,
 * the brand panel on the other. The page, its loading state and its error state share it, so
 * the skip link, the landmarks and the display menus stay in every state.
 */
export function LoginLayout({
  busy = false,
  children,
}: Readonly<{ busy?: boolean; children: ReactNode }>) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <SkipLink />
      <div className="flex flex-col gap-4 p-4 sm:p-6 md:p-10">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <BrandLink />
          <DisplayMenus signedIn={false} />
        </header>
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          aria-busy={busy}
          className="relative flex flex-1 items-center justify-center py-6 outline-none"
        >
          {children}
        </main>
      </div>
      <BrandPanel className="min-h-40 lg:min-h-0" />
    </div>
  );
}

/** The loading state of the login page: its heading and the shape of the sign-in options. */
export function LoginSkeleton({ className }: Readonly<{ className?: string }>) {
  return (
    <div className={cn("flex w-full max-w-sm flex-col gap-6", className)}>
      <LoginHeading />
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">{m.loading()}</span>
        <Skeleton aria-hidden="true" className="h-10 w-full" />
        <Skeleton aria-hidden="true" className="h-10 w-full" />
        <Skeleton aria-hidden="true" className="h-8 w-full" />
      </div>
    </div>
  );
}
