// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { type ReactNode, useEffect, useRef, useState } from "react";
import { LanguageMenu } from "@/components/language-menu";
import { AppBreadcrumb } from "@/components/shell/app-breadcrumb";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/skip-link";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { readSidebarOpen } from "@/lib/preferences";
import { sidebarCookie } from "@/lib/theme";
import type { SessionUser } from "@/server/authz";

/**
 * The sidebar toggle, with its state exposed to assistive technology. The phone sheet has no
 * Radix trigger of its own, so focus returns here when it closes (WCAG 2.4.3).
 */
function ShellSidebarTrigger() {
  const { isMobile, open, openMobile } = useSidebar();
  const ref = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(openMobile);
  useEffect(() => {
    if (wasOpen.current && !openMobile) ref.current?.focus();
    wasOpen.current = openMobile;
  }, [openMobile]);

  return (
    <SidebarTrigger ref={ref} className="-ml-1" aria-expanded={isMobile ? openMobile : open} />
  );
}

/**
 * The signed-in layout (the sidebar-07 block's page): the sidebar, a top bar with the sidebar
 * toggle, the breadcrumb and the language menu, and the page in `main`. The sidebar's
 * open state comes from its cookie on both sides, so the server renders it without a flash, and
 * eduLIMS stores it in its own `__Host-` cookie over https.
 */
export function AppShell({ user, children }: Readonly<{ user: SessionUser; children: ReactNode }>) {
  const [open, setOpen] = useState(() => readSidebarOpen());
  const changeOpen = (next: boolean) => {
    // biome-ignore lint/suspicious/noDocumentCookie: the server reads it on the next request; the Cookie Store API is not in every supported browser
    document.cookie = sidebarCookie(next, window.location.protocol === "https:");
    setOpen(next);
  };
  return (
    <SidebarProvider open={open} onOpenChange={changeOpen}>
      <SkipLink />
      <AppSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
          <ShellSidebarTrigger />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <AppBreadcrumb />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <LanguageMenu signedIn />
          </div>
        </header>
        <SidebarInset
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl px-4 py-6 outline-none md:px-8 md:py-8"
        >
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
