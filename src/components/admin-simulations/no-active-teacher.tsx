// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, UserXIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";

/** The list's marker of a simulation that nobody can manage: an icon and text (WCAG 1.4.1). */
export function NoActiveTeacherBadge() {
  return (
    <Badge variant="destructive">
      <UserXIcon aria-hidden="true" data-icon="inline-start" />
      {m.admin_simulations_no_active_teacher()}
    </Badge>
  );
}

/**
 * The detail page's notice of a simulation whose teachers all lost the app role teacher (#291),
 * with what an administrator can do about it and a link to Users and roles.
 */
export function NoActiveTeacherAlert() {
  return (
    <Alert variant="destructive">
      <UserXIcon aria-hidden="true" />
      <AlertTitle>{m.admin_simulations_no_active_teacher()}</AlertTitle>
      <AlertDescription>
        <p>{m.admin_simulations_no_active_teacher_body()}</p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <Link to="/admin/users">
            {m.admin_simulations_open_users()}
            <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
