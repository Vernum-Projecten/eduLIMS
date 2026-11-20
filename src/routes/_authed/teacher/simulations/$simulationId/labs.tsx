// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { m } from "@/i18n/messages";

// The labs of a simulation and each lab below them: the breadcrumb's "Labs" step, so a lab's page
// reads Simulation › Labs › Lab (#381).
export const Route = createFileRoute("/_authed/teacher/simulations/$simulationId/labs")({
  loader: () => ({ crumb: m.simulation_nav_labs() }),
  component: Outlet,
});
