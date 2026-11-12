// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useDebouncedValue } from "@tanstack/react-pacer";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { SEARCH_DEBOUNCE_MS } from "@/components/data-table/data-table-toolbar";
import { type BaseFieldProps, FieldFeedback, useFieldA11y } from "@/components/form/field-a11y";
import { useFieldContext } from "@/components/form/form-context";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { m } from "@/i18n/messages";
import { teacherCandidatesQueryOptions } from "@/server/classes/admin-query-options";
import { ADMIN_CLASS_SEARCH_MAX } from "@/server/classes/admin-schemas";

/** The status line of the list: searching, a failure or no match, announced as it changes. */
function searchStatus(search: { pending: boolean; isError: boolean; count: number | undefined }) {
  if (search.isError) return m.classes_admin_owner_search_error();
  if (search.pending && search.count === undefined) return m.classes_admin_owner_searching();
  if (search.count === 0) return m.classes_admin_owner_search_empty();
  return null;
}

/**
 * The owner of a class as a form field (#37): a button that opens a search over the teachers
 * who are not blocked, run on the server as the administrator types (debounced), the shadcn
 * Popover and Command pattern. The value is the chosen user's id; `except` leaves a user out
 * (the current owner of a transfer). Keyboard: Enter or Space opens it, the arrows move through
 * the matches, Enter picks one and Escape closes it.
 */
export function OwnerComboboxField({
  label,
  description,
  placeholder,
  except,
  className,
}: BaseFieldProps & { readonly placeholder: string; readonly except?: string | undefined }) {
  const field = useFieldContext<string>();
  const a11y = useFieldA11y(field, description);
  const labelId = useId();
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<{ id: string; label: string } | null>(null);
  const [query] = useDebouncedValue(text, { wait: SEARCH_DEBOUNCE_MS });
  const search = useQuery({ ...teacherCandidatesQueryOptions(query), enabled: open });
  const matches = search.data?.filter((teacher) => teacher.id !== except);
  const status = searchStatus({
    pending: search.isFetching || query !== text,
    isError: search.isError,
    count: matches?.length,
  });
  const value = field.state.value;
  const shown = chosen !== null && chosen.id === value ? chosen.label : null;

  return (
    <Field data-invalid={a11y.isInvalid} className={className}>
      <FieldLabel id={labelId} htmlFor={a11y.controlId}>
        {label}
      </FieldLabel>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setText("");
            field.handleBlur();
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            {...a11y.controlProps}
            type="button"
            variant="outline"
            aria-labelledby={`${labelId} ${valueId}`}
            className="w-full justify-between font-normal sm:w-80"
          >
            <span id={valueId} className="truncate">
              {shown ?? placeholder}
            </span>
            <ChevronsUpDownIcon aria-hidden="true" data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-72 p-0"
          align="start"
          aria-label={label}
        >
          <Command shouldFilter={false} label={label}>
            <CommandInput
              value={text}
              onValueChange={(next) => setText(next.slice(0, ADMIN_CLASS_SEARCH_MAX))}
              placeholder={m.classes_admin_owner_search()}
            />
            <p
              role="status"
              className="px-2 py-3 text-center text-sm text-muted-foreground empty:hidden"
            >
              {status}
            </p>
            <CommandList label={label}>
              {matches && matches.length > 0 && (
                <CommandGroup>
                  {matches.map((teacher) => {
                    const picked = teacher.id === value;
                    return (
                      <CommandItem
                        key={teacher.id}
                        value={teacher.id}
                        data-checked={picked}
                        aria-checked={picked}
                        onSelect={() => {
                          field.handleChange(teacher.id);
                          setChosen({
                            id: teacher.id,
                            label: m.classes_admin_teacher_option({
                              name: teacher.name,
                              email: teacher.email,
                            }),
                          });
                          setOpen(false);
                          setText("");
                        }}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{teacher.name}</span>
                          <span className="truncate text-xs">{teacher.email}</span>
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldFeedback a11y={a11y} description={description} />
    </Field>
  );
}
