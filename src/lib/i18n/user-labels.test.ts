// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { ADMIN_ACTION_ERRORS } from "@/server/users/actions";
import {
  adminActionErrorMessage,
  auditActionLabel,
  auditActorLabel,
  auditOutcomeLabel,
  languageLabel,
  roleSourceLabel,
  signInMethodLabel,
  userStatusLabel,
} from "./user-labels";

describe("user labels (#34)", () => {
  it("names every role source and sign-in method", () => {
    expect(roleSourceLabel("microsoft")).toBe("Microsoft Entra ID");
    expect(roleSourceLabel("keycloak")).toBe("Keycloak");
    expect(roleSourceLabel("local")).toBe("eduLIMS");
    expect(roleSourceLabel(null)).toBe("Unknown");
    expect(signInMethodLabel("credential")).toBe("Test account");
    expect(signInMethodLabel("microsoft")).toBe("Microsoft Entra ID");
    expect(signInMethodLabel("keycloak")).toBe("Keycloak");
  });

  it("names every status", () => {
    expect(userStatusLabel("active")).toBe("Active");
    expect(userStatusLabel("blocked")).toBe("Blocked");
    expect(userStatusLabel("never")).toBe("Never signed in");
  });

  it("names activity-log actions, outcomes and actors, with a fallback", () => {
    expect(auditActionLabel("user_banned")).toBe("Blocked");
    expect(auditActionLabel("class_created")).toBe("Other activity");
    expect(auditActionLabel("toString")).toBe("Other activity");
    expect(auditOutcomeLabel("success")).toBe("succeeded");
    expect(auditOutcomeLabel("refused")).toBe("refused");
    expect(auditOutcomeLabel("failure")).toBe("failed");
    expect(auditActorLabel("self")).toBe("by this user");
    expect(auditActorLabel("user")).toBe("by an administrator");
    expect(auditActorLabel("system")).toBe("by eduLIMS");
    expect(auditActorLabel("anonymous")).toBe("before sign-in");
  });

  it("gives every admin action error its own message", () => {
    const messages = ADMIN_ACTION_ERRORS.map(adminActionErrorMessage);
    expect(new Set(messages).size).toBe(ADMIN_ACTION_ERRORS.length);
    expect(adminActionErrorMessage("something_else")).toBe(adminActionErrorMessage("failed"));
  });

  it("names a language in the active locale", () => {
    expect(languageLabel("nl")).toBe("Dutch");
    expect(languageLabel("not a locale!")).toBe("not a locale!");
  });
});
