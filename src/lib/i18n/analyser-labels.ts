// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The translated names of the analyser register and the integration status (B3, #35).
import { m } from "@/i18n/messages";
import type { AnalyserRoute, AnalyserStatus } from "@/lib/analysers";
import type { CheckErrorClass, Integration, IntegrationDisplayState } from "@/lib/integrations";

/** Returns the name of an analyser's route to FerroEHR. */
export function analyserRouteLabel(route: AnalyserRoute): string {
  switch (route) {
    case "hl7_ferrobridge":
      return m.admin_analysers_route_hl7();
    case "excel_upload":
      return m.admin_analysers_route_excel();
    default: {
      const unknown: never = route;
      return unknown;
    }
  }
}

/** Returns the name of an analyser status. */
export function analyserStatusLabel(status: AnalyserStatus): string {
  switch (status) {
    case "in_use":
      return m.admin_analysers_status_in_use();
    case "maintenance":
      return m.admin_analysers_status_maintenance();
    case "retired":
      return m.admin_analysers_status_retired();
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

/** Returns the message of a refused or failed change to the register. */
export function analyserErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return m.admin_analysers_error_not_found();
    case "serial_taken":
      return m.admin_analysers_error_serial_taken();
    case "retired":
      return m.admin_analysers_error_retired();
    default:
      return m.admin_analysers_error_failed();
  }
}

/** Returns the name of an integration. */
export function integrationLabel(integration: Integration): string {
  switch (integration) {
    case "ferroehr":
      return m.admin_integrations_ferroehr();
    case "ferrobridge":
      return m.admin_integrations_ferrobridge();
    default: {
      const unknown: never = integration;
      return unknown;
    }
  }
}

/** Returns what an integration does, in one line under its name. */
export function integrationDescription(integration: Integration): string {
  switch (integration) {
    case "ferroehr":
      return m.admin_integrations_ferroehr_description();
    case "ferrobridge":
      return m.admin_integrations_ferrobridge_description();
    default: {
      const unknown: never = integration;
      return unknown;
    }
  }
}

/** Returns the name of what the screen shows for an integration. */
export function integrationStateLabel(state: IntegrationDisplayState): string {
  switch (state) {
    case "available":
      return m.admin_integrations_state_available();
    case "unavailable":
      return m.admin_integrations_state_unavailable();
    case "refused":
      return m.admin_integrations_state_refused();
    case "not_checked":
      return m.admin_integrations_state_not_checked();
    case "unknown":
      return m.admin_integrations_state_unknown();
    default: {
      const unknown: never = state;
      return unknown;
    }
  }
}

/** Returns why a check failed, in words an administrator can act on. */
export function checkErrorLabel(errorClass: CheckErrorClass): string {
  switch (errorClass) {
    case "timeout":
      return m.admin_integrations_error_timeout();
    case "unreachable":
      return m.admin_integrations_error_unreachable();
    case "auth_refused":
      return m.admin_integrations_error_auth_refused();
    case "http_client_error":
      return m.admin_integrations_error_http_client();
    case "http_server_error":
      return m.admin_integrations_error_http_server();
    case "unexpected_response":
      return m.admin_integrations_error_unexpected();
    default: {
      const unknown: never = errorClass;
      return unknown;
    }
  }
}
