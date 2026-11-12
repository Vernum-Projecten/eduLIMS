// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  GraduationCapIcon,
  type LucideIcon,
  PresentationIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { Role } from "@/lib/roles";

/**
 * The icon of each role, shared by the role filter, the role badges and the overview tiles so a
 * role looks the same everywhere. The icon always sits beside the role's name (WCAG 1.4.1).
 */
export const ROLE_ICONS = {
  student: GraduationCapIcon,
  teacher: PresentationIcon,
  admin: ShieldCheckIcon,
} as const satisfies Record<Role, LucideIcon>;
