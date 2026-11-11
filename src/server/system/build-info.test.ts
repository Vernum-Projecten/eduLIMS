// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { BuildInfoInvalidError, readBuildInfo } from "./build-info.ts";

const RELEASE = {
  EDULIMS_BUILD_VERSION: "1.2.3",
  EDULIMS_BUILD_REVISION: "0123456789abcdef0123456789abcdef01234567",
  EDULIMS_BUILD_CREATED: "2026-11-12T09:30:00.000Z",
  EDULIMS_BUILD_PROVENANCE: "oci://ghcr.io/vernum-projecten/edulims:1.2.3",
};

describe("readBuildInfo (#36)", () => {
  it("reads every value a release image carries", () => {
    expect(readBuildInfo(RELEASE)).toEqual({
      version: "1.2.3",
      revision: "0123456789abcdef0123456789abcdef01234567",
      createdAt: "2026-11-12T09:30:00.000Z",
      provenance: "oci://ghcr.io/vernum-projecten/edulims:1.2.3",
    });
  });

  it("has no value on a development server", () => {
    expect(readBuildInfo({})).toEqual({
      version: null,
      revision: null,
      createdAt: null,
      provenance: null,
    });
  });

  it("treats the Dockerfile defaults of a local image build as not set", () => {
    expect(
      readBuildInfo({
        EDULIMS_BUILD_VERSION: "dev",
        EDULIMS_BUILD_REVISION: "unknown",
        EDULIMS_BUILD_CREATED: "unknown",
        EDULIMS_BUILD_PROVENANCE: "",
      }),
    ).toEqual({ version: null, revision: null, createdAt: null, provenance: null });
  });

  it("reads a pre-release version", () => {
    expect(readBuildInfo({ EDULIMS_BUILD_VERSION: "1.0.0-rc.1" }).version).toBe("1.0.0-rc.1");
  });

  it.each([
    ["a version that is no semver", { EDULIMS_BUILD_VERSION: "latest" }],
    ["a short commit", { EDULIMS_BUILD_REVISION: "0123456" }],
    ["a build time that is no instant", { EDULIMS_BUILD_CREATED: "yesterday" }],
    ["a provenance outside GHCR", { EDULIMS_BUILD_PROVENANCE: "https://example.test/x" }],
  ])("fails loud on %s", (_name, env) => {
    expect(() => readBuildInfo(env)).toThrow(BuildInfoInvalidError);
  });
});
