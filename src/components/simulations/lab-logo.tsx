// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { FlaskConicalIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-8 [&_svg]:size-4",
  md: "size-12 [&_svg]:size-5",
  lg: "size-32 [&_svg]:size-10",
} as const;

/**
 * A lab's logo in a square frame (D10, #293), or the lab icon when `src` is `null`, so a lab
 * without a logo asks for no image. `alt` is the text alternative; pass `""` where the lab's
 * name stands right beside the logo, so a screen reader does not read the name twice.
 */
export function LabLogo({
  src,
  alt,
  size,
  className,
}: Readonly<{
  src: string | null;
  alt: string;
  size: keyof typeof SIZES;
  className?: string;
}>) {
  const frame = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground",
    SIZES[size],
    className,
  );
  if (src === null) {
    return (
      <span className={frame}>
        <FlaskConicalIcon aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cn(frame, "bg-background")}>
      <img src={src} alt={alt} className="size-full object-contain" decoding="async" />
    </span>
  );
}
