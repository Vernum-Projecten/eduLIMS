// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { TanStackDevtools } from "@tanstack/react-devtools";
import { FormDevtoolsPanel } from "@tanstack/react-form-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

/**
 * The one TanStack Devtools panel with the Router, Query and Form plugins. Loaded only by
 * {@link DevtoolsLoader} in a development build; never import it from anywhere else.
 *
 * The Form plugin needs no registry: every `useForm` (and the `useAppForm` of #61, which wraps
 * it) reports to the devtools event bus by itself.
 *
 * @see https://tanstack.com/devtools/latest/docs/framework/react/basic-setup
 */
export function AppDevtools() {
  return (
    <TanStackDevtools
      plugins={[
        { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
        { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
        { name: "TanStack Form", render: <FormDevtoolsPanel /> },
      ]}
    />
  );
}
