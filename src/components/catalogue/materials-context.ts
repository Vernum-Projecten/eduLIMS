// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createContext, useContext } from "react";

/**
 * The materials the catalogue uses, which the page just read from its query and forwards to the
 * test form's suggestions (#393); it holds no copy of its own.
 */
export const CatalogueMaterialsContext = createContext<readonly string[]>([]);

/** Returns the materials the catalogue uses, for the material field's suggestions. */
export function useCatalogueMaterials(): readonly string[] {
  return useContext(CatalogueMaterialsContext);
}
