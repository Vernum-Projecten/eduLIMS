// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The portal navigation: one entry per portal with its overview and its sections. The sidebar,
// the breadcrumb, the overview cards and the section pages all read this one table.
import {
  ActivityIcon,
  BackpackIcon,
  BookOpenCheckIcon,
  CableIcon,
  ChartColumnIcon,
  ClipboardCheckIcon,
  FlaskConicalIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MicroscopeIcon,
  PresentationIcon,
  SendIcon,
  ShieldCheckIcon,
  TestTubesIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import { m } from "@/i18n/messages";
import type { Role } from "@/lib/roles";
import type { FileRoutesByTo } from "@/routeTree.gen";
import { hasRole, type SessionUser } from "@/server/authz";

/** A path the router knows. */
export type AppPath = keyof FileRoutesByTo;

/** One navigation entry: a portal's overview or one of its sections. */
export interface NavItem {
  id: string;
  to: AppPath;
  icon: LucideIcon;
  /** The label in the sidebar, the breadcrumb and the page heading. */
  label: () => string;
  /** The section's purpose in one sentence. */
  description: () => string;
}

/** One portal: its role, its name and its pages. */
export interface PortalNavigation {
  role: Role;
  label: () => string;
  /** The portal's icon in the portal switcher. */
  icon: LucideIcon;
  overview: NavItem;
  sections: readonly NavItem[];
}

const STUDENT = {
  role: "student",
  label: m.portal_student,
  icon: BackpackIcon,
  overview: {
    id: "overview",
    to: "/student",
    icon: LayoutDashboardIcon,
    label: m.nav_overview,
    description: m.portal_student_intro,
  },
  sections: [
    {
      id: "practicals",
      to: "/student/practicals",
      icon: FlaskConicalIcon,
      label: m.nav_practicals,
      description: m.section_student_practicals,
    },
    {
      id: "samples",
      to: "/student/samples",
      icon: TestTubesIcon,
      label: m.nav_samples,
      description: m.section_student_samples,
    },
    {
      id: "results",
      to: "/student/results",
      icon: MicroscopeIcon,
      label: m.nav_results,
      description: m.section_student_results,
    },
    {
      id: "submissions",
      to: "/student/submissions",
      icon: SendIcon,
      label: m.nav_submissions,
      description: m.section_student_submissions,
    },
    {
      id: "grades",
      to: "/student/grades",
      icon: GraduationCapIcon,
      label: m.nav_grades,
      description: m.section_student_grades,
    },
  ],
} as const satisfies PortalNavigation;

const TEACHER = {
  role: "teacher",
  label: m.portal_teacher,
  icon: PresentationIcon,
  overview: {
    id: "overview",
    to: "/teacher",
    icon: LayoutDashboardIcon,
    label: m.nav_overview,
    description: m.portal_teacher_intro,
  },
  sections: [
    {
      id: "practicals",
      to: "/teacher/practicals",
      icon: FlaskConicalIcon,
      label: m.nav_practicals,
      description: m.section_teacher_practicals,
    },
    {
      id: "classes",
      to: "/teacher/classes",
      icon: UsersRoundIcon,
      label: m.nav_classes,
      description: m.section_teacher_classes,
    },
    {
      id: "results",
      to: "/teacher/results",
      icon: MicroscopeIcon,
      label: m.nav_results,
      description: m.section_teacher_results,
    },
    {
      id: "grading",
      to: "/teacher/grading",
      icon: ClipboardCheckIcon,
      label: m.nav_grading,
      description: m.section_teacher_grading,
    },
    {
      id: "kpi-dashboard",
      to: "/teacher/kpi-dashboard",
      icon: ChartColumnIcon,
      label: m.nav_kpi_dashboard,
      description: m.section_teacher_kpi_dashboard,
    },
  ],
} as const satisfies PortalNavigation;

const ADMIN = {
  role: "admin",
  label: m.portal_admin,
  icon: ShieldCheckIcon,
  overview: {
    id: "overview",
    to: "/admin",
    icon: LayoutDashboardIcon,
    label: m.nav_overview,
    description: m.portal_admin_intro,
  },
  sections: [
    {
      id: "users",
      to: "/admin/users",
      icon: UsersIcon,
      label: m.nav_users_roles,
      description: m.section_admin_users,
    },
    {
      id: "classes",
      to: "/admin/classes",
      icon: BookOpenCheckIcon,
      label: m.nav_classes,
      description: m.section_admin_classes,
    },
    {
      id: "integrations",
      to: "/admin/integrations",
      icon: CableIcon,
      label: m.nav_analysers_integrations,
      description: m.section_admin_integrations,
    },
    {
      id: "activity",
      to: "/admin/activity",
      icon: ActivityIcon,
      label: m.nav_activity_log,
      description: m.section_admin_activity,
    },
  ],
} as const satisfies PortalNavigation;

/**
 * Every portal, in the fallback order of `landingPortal` (src/server/authz.ts, ADR 0012), which
 * is also the order of the portal switcher and its shortcuts.
 */
export const PORTALS = [TEACHER, ADMIN, STUDENT] as const satisfies readonly PortalNavigation[];

type Portals = (typeof PORTALS)[number];
/** The section ids of the portal for `role`. */
export type SectionId<R extends Role> = Extract<Portals, { role: R }>["sections"][number]["id"];

/** Returns the portals `user` may open, so the sidebar never offers another role's pages. */
export function navigationFor(
  user: Pick<SessionUser, "roles"> | null | undefined,
): PortalNavigation[] {
  return PORTALS.filter((portal) => hasRole(user, portal.role));
}

/** Returns the portal for `role`. */
export function portalNavigation(role: Role): PortalNavigation {
  const portal = PORTALS.find((candidate) => candidate.role === role);
  if (!portal) throw new Error(`No navigation for role ${role}`);
  return portal;
}

/** Returns section `id` of the portal for `role`. */
export function sectionOf<R extends Role>(role: R, id: SectionId<R>): NavItem {
  const section = portalNavigation(role).sections.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`No section ${id} in the ${role} portal`);
  return section;
}

/** Strips a trailing slash, so "/student/" and "/student" compare equal. */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * Returns the portal `pathname` lies in (`/teacher/grading` is in the teacher portal), or
 * `null` outside the portals. The URL is the only source of the current portal (ADR 0012).
 */
export function portalOfPath(pathname: string): PortalNavigation | null {
  const path = normalizePath(pathname);
  return (
    PORTALS.find(
      (portal) => path === portal.overview.to || path.startsWith(`${portal.overview.to}/`),
    ) ?? null
  );
}

/** The breadcrumb trail of a page: its portal, then the page itself. */
export interface Breadcrumb {
  portal: PortalNavigation;
  page: NavItem;
}

/** Returns the breadcrumb for `pathname`, or `null` for a page outside the portals. */
export function breadcrumbFor(pathname: string): Breadcrumb | null {
  const path = normalizePath(pathname);
  for (const portal of PORTALS) {
    const page = [portal.overview, ...portal.sections].find((item) => item.to === path);
    if (page) return { portal, page };
  }
  return null;
}

/** Returns the two-letter initials of `name` for an avatar ("Test Student" → "TS"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words.at(0);
  if (!first) return "?";
  const last = words.length > 1 ? words.at(-1) : undefined;
  const letters = last ? `${first[0] ?? ""}${last[0] ?? ""}` : first.slice(0, 2);
  return letters.toLocaleUpperCase();
}
