// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { m } from "@/i18n/messages";
import { paraglideMiddleware } from "@/i18n/server";
import { ROLES } from "@/lib/roles";
import { THEMES } from "@/lib/theme";
import { providerLabel, roleLabel, rolesLabel, roleWriteErrorMessage, themeLabel } from "./labels";
import { defineLocaleCookieServerStrategy } from "./locale-cookie";

// The server entry registers the locale cookie strategy; plain http, as in development.
defineLocaleCookieServerStrategy(() => false);

/** Runs `fn` inside a request whose locale cookie is `locale`, as the server entry does. */
async function inLocale<T>(locale: "en" | "nl", fn: () => T): Promise<T> {
  let result: T | undefined;
  await paraglideMiddleware(
    new Request("http://localhost/", { headers: { cookie: `EDULIMS_LOCALE=${locale}` } }),
    () => {
      result = fn();
      return new Response(null);
    },
  );
  if (result === undefined) throw new Error("the middleware did not run the callback");
  return result;
}

describe("roleLabel", () => {
  it("names the roles in English by default", () => {
    expect(ROLES.map(roleLabel)).toEqual(["Student", "Teacher", "Administrator"]);
  });

  it("names the roles in Dutch inside a Dutch request", async () => {
    const labels = await inLocale("nl", () => [roleLabel("teacher"), roleLabel("admin")]);
    const dutch = { locale: "nl" } as const;
    expect(labels).toEqual([m.role_teacher({}, dutch), m.role_admin({}, dutch)]);
    expect(labels).not.toEqual(["Teacher", "Administrator"]);
  });
});

describe("providerLabel", () => {
  it("localizes the default button texts", async () => {
    expect(providerLabel({ id: "microsoft" })).toBe("Sign in with Microsoft");
    expect(providerLabel({ id: "keycloak" })).toBe("Sign in with Keycloak");
    const dutch = await inLocale("nl", () => providerLabel({ id: "keycloak" }));
    expect(dutch).toBe(m.login_keycloak({}, { locale: "nl" }));
    expect(dutch).not.toBe("Sign in with Keycloak");
  });

  it("shows the operator's KEYCLOAK_LABEL as configured", async () => {
    const provider = { id: "keycloak", label: "Sign in with Campus ID" } as const;
    expect(await inLocale("nl", () => providerLabel(provider))).toBe("Sign in with Campus ID");
  });
});

describe("themeLabel", () => {
  it("names the themes in English and Dutch", async () => {
    expect(THEMES.map(themeLabel)).toEqual(["Light", "Dark", "System"]);
    expect(await inLocale("nl", () => THEMES.map(themeLabel))).toEqual([
      "Licht",
      "Donker",
      "Systeem",
    ]);
  });
});

describe("rolesLabel", () => {
  it("joins the display names of a role set", () => {
    expect(rolesLabel(["teacher", "admin"])).toBe("Teacher · Administrator");
  });
});

describe("roleWriteErrorMessage", () => {
  it("translates the refused role writes and nothing else", () => {
    expect(roleWriteErrorMessage("cannot_change_own_roles")).toBe(m.role_error_own_roles());
    expect(roleWriteErrorMessage("role_conflict")).toBe(m.role_error_not_allowed());
    expect(roleWriteErrorMessage("something else")).toBeNull();
    expect(roleWriteErrorMessage(undefined)).toBeNull();
  });
});
