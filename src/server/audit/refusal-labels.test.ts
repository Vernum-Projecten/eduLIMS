// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Every refusal code a service writes to the activity log has words (B4): the log shows a code
// without words as the bare code, so a new refusal must not ship without its label in `en` and
// `nl`. The codes come from the service sources, so a new one fails this test until it is named.
import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { m } from "@/i18n/messages";
import { activityReasonLabel } from "@/lib/i18n/activity-labels";
import { handWrittenSources } from "../test-source-files.ts";

/** A refused activity-log row with its reason written as a literal, in either order. */
const REFUSED_LITERAL = [
  /outcome: "refused",\s*reason: "([a-z0-9_]+)"/g,
  /reason: "([a-z0-9_]+)",\s*outcome: "refused"/g,
];

/**
 * A call of the results service's `refuse` helpers, which write the refused row with the codes
 * they name. Other areas' `refuse` (the Gen5 reader's) returns a value and logs nothing.
 */
const REFUSE_CALL = /\brefuse(?:<\w+>)?\(/g;

/** Returns the arguments of every `refuse` call in `source`, skipping the helper's definition. */
function refuseArguments(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(REFUSE_CALL)) {
    const start = match.index;
    if (source.slice(Math.max(0, start - 9), start) === "function ") continue;
    const open = start + match[0].length;
    const close = source.indexOf(");", open);
    if (close !== -1) calls.push(source.slice(open, close));
  }
  return calls;
}

/**
 * Refusal codes a service passes to the log through a variable, not a literal: the catalogue
 * test checks of the tolerances (`testRefusal`) and the correct values (D9, D10, #267).
 */
const PASSED_THROUGH = ["test_not_found", "test_retired", "missing_limits"];

/** Returns every refusal code the services under src/server write to the activity log. */
async function loggedRefusals(): Promise<string[]> {
  const codes = new Set(PASSED_THROUGH);
  for (const [file, source] of await handWrittenSources("src/server")) {
    if (!/\.ts$/.test(file) || /\.test\.ts$/.test(file) || /\/test-[^/]*$/.test(file)) continue;
    for (const pattern of REFUSED_LITERAL) {
      for (const match of source.matchAll(pattern)) codes.add(match[1] ?? "");
    }
    if (!file.split(sep).join("/").includes("src/server/results/")) continue;
    for (const call of refuseArguments(source)) {
      for (const literal of call.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
        codes.add(literal[1] ?? "");
      }
    }
  }
  // The source kind `manual` names which refusal applies; it is not itself a code.
  codes.delete("manual");
  return [...codes].sort();
}

describe("the words of every logged refusal (B4)", () => {
  it("finds the refusals of the results, records and simulation services", async () => {
    const codes = await loggedRefusals();
    for (const code of ["released", "tolerance_changed", "test_removed", "has_records"]) {
      expect(codes).toContain(code);
    }
  }, 60_000);

  it("names each one, never as the bare code", async () => {
    const unnamed = (await loggedRefusals()).filter(
      (code) => activityReasonLabel(code) === m.admin_activity_reason_code({ code }),
    );
    expect(unnamed).toEqual([]);
  }, 60_000);

  it("names them in Dutch too", async () => {
    const unnamed = (await loggedRefusals()).filter(
      (code) =>
        activityReasonLabel(code) === m.admin_activity_reason_code({ code }, { locale: "nl" }),
    );
    expect(unnamed).toEqual([]);
  }, 60_000);
});
