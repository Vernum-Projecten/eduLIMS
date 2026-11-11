// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";
import { m } from "@/i18n/messages";

export const Route = createFileRoute("/_authed/teacher/")({
  head: () => ({ meta: [{ title: `${m.portal_teacher()} | eduLIMS` }] }),
  component: Page,
});

function Page() {
  const { user } = Route.useRouteContext();
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-semibold">
        {m.portal_teacher()}
      </h1>
      <p className="mt-2">{m.welcome({ name: user.name })}</p>
      <p className="mt-1 text-muted-foreground">{m.portal_teacher_intro()}</p>
    </section>
  );
}
