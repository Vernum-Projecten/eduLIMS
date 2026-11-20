// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { QueryKey } from "@tanstack/react-query";
import { simulationInvalidation, simulationsKeys } from "@/server/simulations/query-options";

/** The entry a delete drops (its page would only answer 404) and the keys it invalidates. */
export interface DeleteKeys {
  removed: QueryKey;
  invalidates: QueryKey[];
}

/**
 * The invalidation keys of every action on the teacher's screens, named per action so a test
 * holds each one. A lab's keys nest under its simulation, so `simulation(id)` reaches its labs.
 */
export const simulationActionKeys = {
  createSimulation: (): QueryKey[] => simulationInvalidation.created(),
  renameSimulation: (simulationId: string): QueryKey[] =>
    simulationInvalidation.simulation(simulationId),
  deleteSimulation: (simulationId: string): DeleteKeys => ({
    removed: simulationsKeys.detail(simulationId),
    invalidates: simulationInvalidation.created(),
  }),
  addTeacher: (simulationId: string): QueryKey[] => simulationInvalidation.simulation(simulationId),
  removeTeacher: (simulationId: string): QueryKey[] =>
    simulationInvalidation.simulation(simulationId),
  /** Removing oneself: the simulation is no longer the teacher's, so its page goes. */
  leaveSimulation: (simulationId: string): DeleteKeys => ({
    removed: simulationsKeys.detail(simulationId),
    invalidates: simulationInvalidation.created(),
  }),
  createLab: (simulationId: string): QueryKey[] => simulationInvalidation.simulation(simulationId),
  renameLab: (simulationId: string): QueryKey[] => simulationInvalidation.simulation(simulationId),
  deleteLab: (simulationId: string, labId: string): DeleteKeys => ({
    removed: simulationsKeys.lab(simulationId, labId),
    invalidates: simulationInvalidation.simulation(simulationId),
  }),
  moveMember: (simulationId: string): QueryKey[] => simulationInvalidation.simulation(simulationId),
  removeMember: (simulationId: string): QueryKey[] =>
    simulationInvalidation.simulation(simulationId),
  /** The preview stores nothing. */
  previewEmails: (): QueryKey[] => [],
  addEmails: (simulationId: string): QueryKey[] => simulationInvalidation.waiting(simulationId),
  removeEmail: (simulationId: string): QueryKey[] => simulationInvalidation.waiting(simulationId),
  enableJoinCode: (simulationId: string, labId: string): QueryKey[] =>
    simulationInvalidation.joinCode(simulationId, labId),
  regenerateJoinCode: (simulationId: string, labId: string): QueryKey[] =>
    simulationInvalidation.joinCode(simulationId, labId),
  disableJoinCode: (simulationId: string, labId: string): QueryKey[] =>
    simulationInvalidation.joinCode(simulationId, labId),
  uploadLabLogo: (simulationId: string): QueryKey[] => simulationInvalidation.logo(simulationId),
  removeLabLogo: (simulationId: string): QueryKey[] => simulationInvalidation.logo(simulationId),
  /** The student's join: their own labs only; the teacher's pages read the new member anew. */
  joinLab: (): QueryKey[] => simulationInvalidation.student(),
};
