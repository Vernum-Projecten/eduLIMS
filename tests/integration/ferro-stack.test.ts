// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// eduLIMS's openEHR client and the B3 health check against the real FerroEHR and FerroBRIDGE of
// compose.dev.yaml, with FerroEHR's authentication on and the dev Keycloak as the token issuer
// (#150, Q-COMP-1). Locally the suite skips itself when FerroEHR does not answer; the CI
// integration lane sets EDULIMS_IT_REQUIRE_STACK=1, so an unreachable stack fails there instead.
// The ports follow EDULIMS_DEV_*_PORT, as scripts/dev/ferroehr-auth-check.sh reads them. The
// client id, secret and scope are the public dev values of docker/keycloak/edulims-realm.json.
import { describe, expect, it } from "vitest";
import { probeAll, probeTargets } from "../../src/server/integrations/probe.ts";
import { createOpenEhrClient, type OpenEhrClient } from "../../src/server/openehr/index.ts";

const port = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const KEYCLOAK = `http://localhost:${port("EDULIMS_DEV_KEYCLOAK_PORT", "8180")}`;
const FERROEHR = `http://localhost:${port("EDULIMS_DEV_FERROEHR_PORT", "8080")}`;
const FERROBRIDGE = `http://localhost:${port("EDULIMS_DEV_FERROBRIDGE_PORT", "8081")}`;
const REQUIRED = process.env["EDULIMS_IT_REQUIRE_STACK"] === "1";

/** The template eduLIMS writes its measurements with (#146). */
const LAB_TEMPLATE_ID = "eduLIMS-lab.v1";

const DEV_CLIENT = {
  baseUrl: new URL(`${FERROEHR}/ferroehr/rest/openehr/v1`),
  tokenUrl: new URL(`${KEYCLOAK}/realms/edulims/protocol/openid-connect/token`),
  clientId: "edulims-ferroehr",
  clientSecret: "edulims-dev-ferroehr-secret",
  scope: "system/template-*.r",
} as const;

/** Returns a client of the dev stack over the global `fetch`, with `secret` when given. */
function stackClient(secret: string = DEV_CLIENT.clientSecret): OpenEhrClient {
  return createOpenEhrClient(
    { ...DEV_CLIENT, clientSecret: secret },
    { fetch: (url, init) => fetch(url, init), nowMs: () => Date.now() },
  );
}

const client = stackClient();
const reachable = (await client.options()).ok;
if (!reachable && !REQUIRED) {
  console.warn(
    `FerroEHR stack test skipped: no FerroEHR at ${DEV_CLIENT.baseUrl.href}. ` +
      "Start the dev stack (pnpm dev:db) to run it.",
  );
}

describe.skipIf(!reachable && !REQUIRED)(
  "FerroEHR and FerroBRIDGE of the Compose stack (#150)",
  () => {
    it("reaches FerroEHR's conformance manifest without a credential", async () => {
      const answer = await client.options();
      expect(answer).toMatchObject({ ok: true });
    });

    it("gets a token from the dev Keycloak and lists FerroEHR's templates (Q-COMP-1)", async () => {
      const answer = await client.listTemplates();
      if (!answer.ok) expect.fail(`listTemplates failed: ${answer.error.kind}`);
      expect(Array.isArray(answer.value)).toBe(true);
    });

    it("is refused at the token endpoint with a wrong client secret", async () => {
      const answer = await stackClient("not-the-dev-secret").listTemplates();
      expect(answer).toMatchObject({
        ok: false,
        error: { kind: "auth_refused", target: "token_endpoint" },
      });
    });

    it(`lists the ${LAB_TEMPLATE_ID} template (S4, S5)`, async () => {
      const answer = await client.listTemplates();
      if (!answer.ok) expect.fail(`listTemplates failed: ${answer.error.kind}`);
      expect(answer.value.map((template) => template.template_id)).toContain(LAB_TEMPLATE_ID);
    });

    it("answers 200 on FerroBRIDGE's readiness", async () => {
      const response = await fetch(`${FERROBRIDGE}/health/readiness`, {
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      expect(response.status).toBe(200);
    });

    const check = () =>
      probeAll(probeTargets({ FERROBRIDGE_BASE_URL: FERROBRIDGE }), {
        openEhr: client,
        fetch: (url, init) => fetch(url, init),
        now: () => new Date(),
        elapsed: () => performance.now(),
      });

    it("reaches FerroEHR and signs in to it in the B3 check (#227)", async () => {
      const [ferroehr, ferrobridge] = await check();
      expect(ferroehr?.ferroehr?.steps).toMatchObject({ reachable: "passed", signed_in: "passed" });
      expect(ferroehr?.ferroehr?.specVersion).not.toBeNull();
      expect(ferrobridge).toMatchObject({ state: "available", errorClass: null });
    });

    it("reports both services available in the B3 check, the template loaded (#227)", async () => {
      const results = await check();
      expect(
        results.map(({ integration, state, errorClass }) => ({ integration, state, errorClass })),
      ).toEqual([
        { integration: "ferroehr", state: "available", errorClass: null },
        { integration: "ferrobridge", state: "available", errorClass: null },
      ]);
      expect(results[0]?.ferroehr?.steps.template_loaded).toBe("passed");
    });
  },
);
