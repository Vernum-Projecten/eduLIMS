// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { UserSearchIcon } from "lucide-react";
import { useState } from "react";
import { SEARCH_DEBOUNCE_MS } from "@/components/data-table/data-table-toolbar";
import type { DataTableColumn } from "@/components/data-table/features";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { m } from "@/i18n/messages";
import type { ActivityRow, ActivityUser } from "@/server/activity/queries";
import { activityUserSearchQueryOptions } from "@/server/activity/query-options";
import { USER_SEARCH_MAX_LENGTH } from "@/server/activity/schemas";

/** What the search list says while there is nothing to pick, announced as it changes. */
function searchStatus(
  text: string,
  search: { isFetching: boolean; isError: boolean; count: number | undefined },
): string | null {
  if (text.trim() === "") return m.admin_activity_user_search_hint();
  if (search.isError) return m.admin_activity_user_search_error();
  if (search.isFetching && search.count === undefined) return m.admin_activity_user_searching();
  if (search.count === 0) return m.admin_activity_user_search_empty();
  return null;
}

/**
 * A filter on one user (#36): a button that opens a search by name or e-mail address, run on
 * the server as the administrator types (debounced), and sets the column's filter to the id of
 * the user picked. The button shows the chosen user's name, which the list read resolved.
 */
export function UserFilter({
  column,
  title,
  chosen,
}: Readonly<{
  column: DataTableColumn<ActivityRow>;
  title: string;
  chosen: ActivityUser | null;
}>) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query] = useDebouncedValue(text, { wait: SEARCH_DEBOUNCE_MS });
  const search = useQuery(activityUserSearchQueryOptions(query));
  const matches = query.trim() === "" ? undefined : search.data;
  const status = searchStatus(text, {
    isFetching: search.isFetching || query !== text,
    isError: search.isError,
    count: matches?.length,
  });
  const chosenName = chosen ? (chosen.name ?? m.admin_activity_user_deleted()) : null;

  function pick(userId: string | undefined) {
    column.setFilterValue(userId);
    setOpen(false);
    setText("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <UserSearchIcon aria-hidden="true" data-icon="inline-start" />
          {title}
          {chosenName && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <span className="sr-only">:</span>
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {chosenName}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start" aria-label={title}>
        <Command shouldFilter={false} label={title}>
          <CommandInput
            value={text}
            onValueChange={(value) => setText(value.slice(0, USER_SEARCH_MAX_LENGTH))}
            placeholder={m.admin_activity_user_search_label()}
          />
          <p
            role="status"
            className="px-2 py-3 text-center text-sm text-muted-foreground empty:hidden"
          >
            {status}
          </p>
          <CommandList label={title}>
            {matches && matches.length > 0 && (
              <CommandGroup>
                {matches.map((user) => (
                  <CommandItem
                    key={user.id}
                    value={user.id}
                    data-checked={user.id === chosen?.id}
                    aria-checked={user.id === chosen?.id}
                    onSelect={() => pick(user.id)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{user.name}</span>
                      <span className="truncate text-xs">{user.email}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {/* A border, not a CommandSeparator: a separator is no allowed child of a listbox. */}
            {chosen && (
              <CommandGroup className="border-t">
                <CommandItem
                  value="clear"
                  onSelect={() => pick(undefined)}
                  className="justify-center text-center"
                >
                  {m.admin_activity_user_clear()}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
