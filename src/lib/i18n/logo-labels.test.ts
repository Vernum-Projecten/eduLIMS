// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// The words of the lab logo field (D10, #293): every refusal code of the server has its own
// message with the limit it broke, in English and in Dutch, and the help text states the types
// and the limits.
import { afterEach, describe, expect, it } from "vitest";
import { baseLocale, overwriteGetLocale } from "@/i18n/runtime";
import { LOGO_REFUSALS } from "@/lib/lab-logo";
import { SIMULATION_ACTION_ERRORS } from "@/server/simulations/access";
import {
  isLogoRefusal,
  logoFieldHelp,
  logoRefusalMessage,
  simulationErrorMessage,
} from "./simulation-labels";

afterEach(() => overwriteGetLocale(() => baseLocale));

describe("logoRefusalMessage (#293)", () => {
  it.each(LOGO_REFUSALS)("gives refusal %s its own message", (code) => {
    expect(logoRefusalMessage(code)).not.toBe("");
    expect(logoRefusalMessage(code)).not.toBe(simulationErrorMessage(null));
  });

  it("gives every refusal a different message", () => {
    const messages = LOGO_REFUSALS.map(logoRefusalMessage);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("names the limit or the types each refusal broke, in English", () => {
    expect(logoRefusalMessage("logo_unsupported_type")).toBe(
      "This file is not a PNG or JPEG image. SVG, GIF and WebP are not accepted.",
    );
    expect(logoRefusalMessage("logo_too_large")).toBe(
      "This file is larger than 512 KiB. Choose a smaller file.",
    );
    expect(logoRefusalMessage("logo_too_many_pixels")).toBe(
      "This image is larger than 1,024 by 1,024 pixels. Make it smaller and try again.",
    );
    expect(logoRefusalMessage("logo_malformed")).toBe(
      "This file looks like a PNG or JPEG image, but it cannot be read. Save it again in your image editor and try again.",
    );
  });

  it("has a Dutch message for every refusal, with the limit", () => {
    const english = LOGO_REFUSALS.map(logoRefusalMessage);
    overwriteGetLocale(() => "nl");
    const dutch = LOGO_REFUSALS.map(logoRefusalMessage);
    for (const [index, message] of dutch.entries()) expect(message).not.toBe(english[index]);
    expect(logoRefusalMessage("logo_too_large")).toBe(
      "Dit bestand is groter dan 512 KiB. Kies een kleiner bestand.",
    );
    expect(logoRefusalMessage("logo_too_many_pixels")).toBe(
      "Deze afbeelding is groter dan 1.024 bij 1.024 pixels. Maak hem kleiner en probeer het nog eens.",
    );
  });
});

describe("isLogoRefusal (#293)", () => {
  it.each(LOGO_REFUSALS)("knows %s as a refusal of the file", (code) => {
    expect(isLogoRefusal(code)).toBe(true);
  });

  it.each(SIMULATION_ACTION_ERRORS)("knows %s as an access refusal", (code) => {
    expect(isLogoRefusal(code)).toBe(false);
  });
});

describe("logoFieldHelp (#293)", () => {
  it("states the types and the limits", () => {
    expect(logoFieldHelp()).toBe(
      "A PNG or JPEG image of at most 512 KiB and at most 1,024 by 1,024 pixels.",
    );
    overwriteGetLocale(() => "nl");
    expect(logoFieldHelp()).toBe(
      "Een PNG- of JPEG-afbeelding van hoogstens 512 KiB en hoogstens 1.024 bij 1.024 pixels.",
    );
  });
});
