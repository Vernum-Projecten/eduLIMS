// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeftIcon, UserMinusIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { DataTableRowActions } from "@/components/data-table/data-table-row-actions";
import { createDataTableColumnHelper } from "@/components/data-table/features";
import { simulationActionKeys } from "@/components/simulations/action-keys";
import { ConfirmDialog, useConfirmation } from "@/components/simulations/confirm-dialog";
import { FOCUSABLE_HEADING, focusById } from "@/components/simulations/focus";
import { ListTable } from "@/components/simulations/list-table";
import { MoveDialog, type MoveTarget } from "@/components/simulations/move-dialog";
import { useSimulationAction } from "@/components/simulations/use-simulation-action";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { m } from "@/i18n/messages";
import { formatDate } from "@/lib/i18n/format";
import { isJoinVia, joinViaLabel } from "@/lib/i18n/simulation-labels";
import { removeMemberFn } from "@/server/simulations/functions";
import type { TeacherLabPage } from "@/server/simulations/queries";
import { simulationMutationOptions } from "@/server/simulations/query-options";

/** The id of the members heading, where focus goes when a row it was on leaves the list. */
export const MEMBERS_HEADING = "members-heading";

/** A member row with what its actions need. */
interface MemberRow extends MoveTarget {
  email: string;
  joinedVia: string;
  joinedAt: string;
  canMove: boolean;
  /** Opens the move dialog, which lives in the section so it outlasts the row it moves. */
  onMove: (trigger: HTMLElement | null) => void;
}

const helper = createDataTableColumnHelper<MemberRow>();

const columns = helper.columns([
  helper.accessor("name", {
    id: "name",
    header: () => m.labs_col_member_name(),
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  }),
  helper.accessor("email", {
    id: "email",
    header: () => m.simulations_col_email(),
    cell: ({ row }) => <span className="break-all">{row.original.email}</span>,
  }),
  helper.accessor("joinedAt", {
    id: "joinedAt",
    header: () => m.labs_col_joined(),
    cell: ({ row }) => (
      <span className="flex flex-col">
        <time dateTime={row.original.joinedAt} className="whitespace-nowrap">
          {formatDate(row.original.joinedAt)}
        </time>
        {isJoinVia(row.original.joinedVia) && (
          <span className="text-muted-foreground">{joinViaLabel(row.original.joinedVia)}</span>
        )}
      </span>
    ),
  }),
  helper.display({
    id: "actions",
    meta: { className: "w-12" },
    header: () => <span className="sr-only">{m.data_table_actions()}</span>,
    cell: ({ row }) => <MemberRowActions member={row.original} />,
  }),
]);

/** The students in a lab: move one to another lab of the simulation, or remove one from it. */
export function MembersSection({ page, busy }: Readonly<{ page: TeacherLabPage; busy: boolean }>) {
  const [moving, setMoving] = useState<{ member: MoveTarget; trigger: HTMLElement | null }>();
  const rows = useMemo(
    () =>
      page.members.map((member): MemberRow => {
        const target: MoveTarget = {
          simulationId: page.simulation.id,
          userId: member.userId,
          name: member.name,
          labName: page.name,
          otherLabs: page.otherLabs,
        };
        return {
          ...target,
          email: member.email,
          joinedVia: member.joinedVia,
          joinedAt: member.joinedAt,
          canMove: page.otherLabs.length > 0,
          onMove: (trigger) => setMoving({ member: target, trigger }),
        };
      }),
    [page.members, page.simulation.id, page.name, page.otherLabs],
  );
  return (
    <section aria-labelledby={MEMBERS_HEADING} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={MEMBERS_HEADING} tabIndex={-1} className={FOCUSABLE_HEADING}>
          {m.labs_members_heading()}
        </h2>
        <p className="text-muted-foreground">{m.labs_members_description()}</p>
      </div>
      <ListTable
        columns={columns}
        data={rows}
        rowId={(row) => row.userId}
        caption={m.labs_members_caption({ lab: page.name })}
        busy={busy}
        empty={<MembersEmpty />}
      />
      {moving && (
        <MoveDialog
          key={moving.member.userId}
          member={moving.member}
          control={{
            open: true,
            onOpenChange: (open) => {
              if (!open) setMoving(undefined);
            },
            onCloseAutoFocus: (event) => {
              event.preventDefault();
              // A moved student has left this list, so focus goes to its heading.
              if (moving.trigger?.isConnected) moving.trigger.focus();
              else focusById(MEMBERS_HEADING);
            },
          }}
        />
      )}
    </section>
  );
}

function MembersEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{m.labs_members_empty_title()}</EmptyTitle>
        <EmptyDescription>{m.labs_members_empty_body()}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function MemberRowActions({ member }: Readonly<{ member: MemberRow }>) {
  const confirmation = useConfirmation(MEMBERS_HEADING);
  const queryClient = useQueryClient();
  const callRemove = useServerFn(removeMemberFn);
  const remove = useSimulationAction(
    simulationMutationOptions(
      queryClient,
      callRemove,
      simulationActionKeys.removeMember(member.simulationId),
    ),
    {
      success: () => m.labs_member_removed({ name: member.name }),
      onDone: confirmation.done,
      onFailed: confirmation.failed,
    },
  );

  return (
    <>
      <DataTableRowActions
        label={m.data_table_row_actions({ name: member.name })}
        triggerRef={confirmation.triggerRef}
      >
        <DropdownMenuItem
          disabled={!member.canMove}
          onSelect={() => member.onMove(confirmation.triggerRef.current)}
        >
          <ArrowRightLeftIcon aria-hidden="true" />
          {member.canMove ? m.labs_member_move() : m.labs_member_move_no_lab()}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={remove.isPending}
          onSelect={confirmation.show}
        >
          <UserMinusIcon aria-hidden="true" />
          {m.labs_member_remove()}
        </DropdownMenuItem>
      </DataTableRowActions>
      <ConfirmDialog
        confirmation={confirmation}
        title={m.labs_member_remove_title({ name: member.name })}
        body={m.labs_member_remove_body()}
        confirm={m.labs_member_remove_confirm()}
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate({ simulationId: member.simulationId, userId: member.userId })
        }
      />
    </>
  );
}
