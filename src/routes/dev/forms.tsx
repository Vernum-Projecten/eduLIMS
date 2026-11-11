// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, notFound } from "@tanstack/react-router";
import { RubricEditor } from "@/components/dev-forms/rubric-editor";
import { SessionForm } from "@/components/dev-forms/session-form";
import { Page } from "@/components/shell/page-header";
import { PublicLayout } from "@/components/shell/public-layout";
import { m } from "@/i18n/messages";
import { getDevPagesEnabled } from "@/lib/dev-tools.functions";

export const Route = createFileRoute("/dev/forms")({
  // Development pages are refused in production: the server answers, so a 404 is real.
  beforeLoad: async () => {
    if (!(await getDevPagesEnabled())) throw notFound();
  },
  head: () => ({ meta: [{ title: `${m.dev_forms_title()} | eduLIMS` }] }),
  component: DevForms,
});

const RUBRIC_HEADING = "rubric-heading";
const SESSION_HEADING = "session-heading";

/** The form foundation (#61) on fictional data: the rubric editor and every field kind. */
function DevForms() {
  const { user } = Route.useRouteContext();
  return (
    <PublicLayout signedIn={user !== null}>
      <Page title={m.dev_forms_title()} description={m.dev_forms_intro()}>
        <section aria-labelledby={RUBRIC_HEADING} className="flex flex-col gap-4">
          <h2 id={RUBRIC_HEADING} className="text-xl font-semibold tracking-tight">
            {m.dev_forms_rubric_heading()}
          </h2>
          <RubricEditor headingId={RUBRIC_HEADING} />
        </section>
        <section aria-labelledby={SESSION_HEADING} className="flex flex-col gap-4">
          <h2 id={SESSION_HEADING} className="text-xl font-semibold tracking-tight">
            {m.dev_forms_session_heading()}
          </h2>
          <SessionForm headingId={SESSION_HEADING} />
        </section>
      </Page>
    </PublicLayout>
  );
}
