// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import {
  BuildingIcon,
  GlobeIcon,
  KeyRoundIcon,
  type LucideIcon,
  SchoolIcon,
  ShieldIcon,
} from "lucide-react";
import type { ProviderIcon } from "@/lib/identity-providers";

/** The lucide icon of each icon choice an administrator can give a login button. */
export const PROVIDER_ICON_COMPONENTS: Readonly<Record<ProviderIcon, LucideIcon>> = {
  "key-round": KeyRoundIcon,
  building: BuildingIcon,
  school: SchoolIcon,
  shield: ShieldIcon,
  globe: GlobeIcon,
};

/** The icon of a login button; decorative, the button's text names the provider. */
export function ProviderIconGlyph({
  icon,
  className,
}: Readonly<{ icon: ProviderIcon; className?: string }>) {
  const Icon = PROVIDER_ICON_COMPONENTS[icon];
  return <Icon aria-hidden="true" data-icon="inline-start" className={className} />;
}
