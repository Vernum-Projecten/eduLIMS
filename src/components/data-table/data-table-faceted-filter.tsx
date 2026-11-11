// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import type { RowData } from "@tanstack/react-table";
import { CheckIcon, type LucideIcon, PlusCircleIcon } from "lucide-react";
import { columnLabel, type DataTableColumn } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { m } from "@/i18n/messages";
import { formatNumber } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";

/** One value a facet offers. */
export interface FacetOption {
  value: string;
  label: string;
  icon?: LucideIcon;
}

// NOTE: no requirement governs this: our own design. Beyond two values the button shows a count.
const MAX_BADGES = 2;

/** Returns the column's filter value as the list of chosen values. */
function chosenValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * A faceted filter (#58), the shadcn data-table pattern: a button that opens a searchable
 * multi-select list (Popover and Command) of the column's values with the number of rows each
 * would show (`counts`, from the server). The chosen values show as badges in the button, and
 * its accessible name says how many are chosen.
 */
export function DataTableFacetedFilter<TData extends RowData, TValue>({
  column,
  title = columnLabel(column),
  options,
  counts,
}: Readonly<{
  column: DataTableColumn<TData, TValue>;
  /** The filter's name; the column's name by default. */
  title?: string;
  options: readonly FacetOption[];
  counts?: Readonly<Partial<Record<string, number>>>;
}>) {
  const chosen = chosenValues(column.getFilterValue());
  const chosenOptions = options.filter((option) => chosen.includes(option.value));

  function toggle(value: string) {
    const next = chosen.includes(value)
      ? chosen.filter((item) => item !== value)
      : options
          .map((option) => option.value)
          .filter((item) => item === value || chosen.includes(item));
    column.setFilterValue(next.length > 0 ? next : undefined);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircleIcon aria-hidden="true" data-icon="inline-start" />
          {title}
          {chosen.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              {chosenOptions.length > MAX_BADGES ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                  {m.data_table_facet_selected({ count: formatNumber(chosenOptions.length) })}
                </Badge>
              ) : (
                <>
                  <span className="sr-only">
                    {m.data_table_facet_selected({ count: formatNumber(chosenOptions.length) })}:
                  </span>
                  {chosenOptions.map((option) => (
                    <Badge
                      key={option.value}
                      variant="secondary"
                      className="rounded-sm px-1 font-normal"
                    >
                      {option.label}
                    </Badge>
                  ))}
                </>
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start" aria-label={title}>
        <Command label={m.data_table_facet_search()}>
          <CommandInput placeholder={title} />
          <CommandList label={title}>
            <CommandEmpty>{m.data_table_facet_empty()}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = chosen.includes(option.value);
                const count = counts?.[option.value];
                const Icon = option.icon;
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    data-checked={checked}
                    aria-checked={checked}
                    onSelect={() => toggle(option.value)}
                  >
                    {/* The shadcn data-table faceted filter: a checkbox first, the count last. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input [&_svg]:invisible",
                      )}
                    >
                      <CheckIcon className="size-3.5" />
                    </span>
                    {Icon && <Icon aria-hidden="true" className="text-muted-foreground" />}
                    <span>{option.label}</span>
                    {/* Always present, so the item's own trailing check stays hidden. */}
                    <CommandShortcut className="tabular-nums tracking-normal">
                      {count === undefined ? null : formatNumber(count)}
                    </CommandShortcut>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {chosen.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column.setFilterValue(undefined)}
                    className="justify-center text-center"
                  >
                    {m.data_table_facet_clear()}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
