// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// What the running build says about itself (#36): the version, the commit, the build time and
// the reference of its SLSA provenance. The image sets these from its build arguments
// (docker/Dockerfile); a development server and a local image build have none of them.
import "@tanstack/react-start/server-only";
import { z } from "zod";

/** The build values of the image, `null` where the build did not set one. */
export interface BuildInfo {
  version: string | null;
  /** The full commit SHA the image was built from. */
  revision: string | null;
  /** The build time, an ISO instant. */
  createdAt: string | null;
  /** The image whose SLSA provenance attestation `gh attestation verify` checks. */
  provenance: string | null;
}

/** Thrown when the image carries a build value outside its format. */
export class BuildInfoInvalidError extends Error {
  override readonly name = "BuildInfoInvalidError";
  readonly kind = "build_info_invalid";
}

// NOTE: no requirement governs this: our own design. The Dockerfile's defaults (`dev`,
// `unknown`, empty) mean a build outside the release lane, which has no value to show.
const UNSET = new Set(["", "dev", "unknown"]);

const buildEnv = z.object({
  EDULIMS_BUILD_VERSION: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    .optional(),
  EDULIMS_BUILD_REVISION: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional(),
  EDULIMS_BUILD_CREATED: z.iso.datetime({ offset: true }).optional(),
  EDULIMS_BUILD_PROVENANCE: z
    .string()
    .regex(/^oci:\/\/ghcr\.io\/[a-z0-9-]+\/[a-z0-9-]+:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    .optional(),
});

/**
 * Returns the build values from `env`. An unset value or a Dockerfile default is `null`.
 *
 * @throws BuildInfoInvalidError when a set value is not in its format, so a broken image fails
 *   loud instead of showing a wrong version.
 */
export function readBuildInfo(env: Readonly<Record<string, string | undefined>>): BuildInfo {
  const pick = (name: keyof z.infer<typeof buildEnv>) => {
    const value = env[name]?.trim();
    return value === undefined || UNSET.has(value) ? undefined : value;
  };
  const parsed = buildEnv.safeParse({
    EDULIMS_BUILD_VERSION: pick("EDULIMS_BUILD_VERSION"),
    EDULIMS_BUILD_REVISION: pick("EDULIMS_BUILD_REVISION"),
    EDULIMS_BUILD_CREATED: pick("EDULIMS_BUILD_CREATED"),
    EDULIMS_BUILD_PROVENANCE: pick("EDULIMS_BUILD_PROVENANCE"),
  });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new BuildInfoInvalidError(`invalid build values: ${names}`, { cause: parsed.error });
  }
  return {
    version: parsed.data.EDULIMS_BUILD_VERSION ?? null,
    revision: parsed.data.EDULIMS_BUILD_REVISION ?? null,
    createdAt: parsed.data.EDULIMS_BUILD_CREATED
      ? new Date(parsed.data.EDULIMS_BUILD_CREATED).toISOString()
      : null,
    provenance: parsed.data.EDULIMS_BUILD_PROVENANCE ?? null,
  };
}
