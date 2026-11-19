// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

// Writes the invented fixtures of this folder from the builder:
// `node tests/fixtures/gen5/generate.ts`. A unit test checks that the committed bytes match.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gradientFixture } from "./xlsx-builder.ts";

const target = fileURLToPath(new URL("epoch2-endpoint-450nm-gradient.xlsx", import.meta.url));
writeFileSync(target, gradientFixture());
