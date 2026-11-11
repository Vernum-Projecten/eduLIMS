// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useSuspenseQuery } from "@tanstack/react-query";
import { MailOpenIcon, SchoolIcon } from "lucide-react";
import { ClassName } from "@/components/classes/class-name";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { m } from "@/i18n/messages";
import { formatDate } from "@/lib/i18n/format";
import { studentClassesQueryOptions } from "@/server/classes/query-options";

/**
 * The student's classes and the pending invitations for their own address (#28), on the
 * Student portal's overview. A pending invitation is accepted at the next sign-in.
 */
export function StudentClasses() {
  const { data } = useSuspenseQuery(studentClassesQueryOptions());
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="my-classes" className="flex flex-col gap-4">
        <h2 id="my-classes" className="text-lg font-semibold">
          {m.classes_student_title()}
        </h2>
        {data.classes.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SchoolIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h3>{m.classes_student_empty()}</h3>
              </EmptyTitle>
              <EmptyDescription>{m.classes_student_empty_body()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.classes.map((item) => (
              <li key={item.id}>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <SchoolIcon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <ClassName
                        name={item.name}
                        academicYear={item.academicYear}
                        archived={item.archivedAt !== null}
                      />
                    </ItemTitle>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.invitations.length > 0 && (
        <section aria-labelledby="my-invitations" className="flex flex-col gap-4">
          <h2 id="my-invitations" className="text-lg font-semibold">
            {m.classes_student_invitations()}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.invitations.map((invitation) => (
              <li key={invitation.id}>
                <Item variant="outline">
                  <ItemMedia variant="icon">
                    <MailOpenIcon aria-hidden="true" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      <ClassName
                        name={invitation.className}
                        academicYear={invitation.academicYear}
                      />
                    </ItemTitle>
                    <ItemDescription>
                      {m.classes_student_invitation_body({
                        date: formatDate(invitation.expiresAt),
                      })}
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
