// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createContext } from "react";

/** What the cells of the users table read besides their row. */
export interface UsersTableContextValue {
  /** The instant the page was read; relative times count from it, so SSR and the client agree. */
  readAt: string;
  /** The administrator's own user id: their row offers no selection and no block. */
  selfId: string;
}

export const UsersTableContext = createContext<UsersTableContextValue>({ readAt: "", selfId: "" });
