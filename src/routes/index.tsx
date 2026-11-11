// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">eduLIMS</h1>
      <p className="mt-2 text-muted-foreground">
        Laboratory Information Management System voor het practicumonderwijs van LifeScience.
      </p>
    </main>
  );
}
