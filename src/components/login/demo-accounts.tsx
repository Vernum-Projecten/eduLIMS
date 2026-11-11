// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ChevronDownIcon, InfoIcon, KeyRoundIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { roleLabel } from "@/lib/i18n/labels";
import type { DemoAccount, DemoAccounts } from "@/server/demo-accounts";

const CELL = "whitespace-normal break-all align-middle";

function AccountTable({
  caption,
  usernameHeader,
  accounts,
  onUse,
}: Readonly<{
  caption: string;
  usernameHeader: string;
  accounts: readonly DemoAccount[];
  onUse?: (account: DemoAccount) => void;
}>) {
  return (
    <Table className="text-xs">
      <TableCaption className="mt-2 text-left">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{m.demo_accounts_role()}</TableHead>
          <TableHead scope="col">{usernameHeader}</TableHead>
          <TableHead scope="col">{m.field_password()}</TableHead>
          {onUse && (
            <TableHead scope="col">
              <span className="sr-only">{m.demo_accounts_fill_in()}</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.username}>
            <TableHead scope="row" className={CELL}>
              {roleLabel(account.role)}
            </TableHead>
            <TableCell className={`${CELL} font-mono`}>{account.username}</TableCell>
            <TableCell className={`${CELL} font-mono`}>{account.password}</TableCell>
            {onUse && (
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={m.demo_accounts_use_label({ role: roleLabel(account.role) })}
                  onClick={() => onUse(account)}
                >
                  {m.demo_accounts_use()}
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The public development accounts, collapsed under the sign-in options. The server sends them
 * only while the development login is enabled; "Use" fills the test-account form without
 * submitting it.
 */
export function DemoAccountsPanel({
  accounts,
  onUse,
}: Readonly<{ accounts: DemoAccounts; onUse: (account: DemoAccount) => void }>) {
  return (
    <Collapsible className="rounded-lg border bg-card">
      <h2>
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="group w-full justify-between rounded-lg px-3"
          >
            <span className="flex items-center gap-2">
              <KeyRoundIcon aria-hidden="true" />
              {m.demo_accounts_title()}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="transition-transform group-data-[state=open]:rotate-180"
            />
          </Button>
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent className="flex flex-col gap-4 px-3 pb-3">
        <AccountTable
          caption={m.demo_accounts_dev_login()}
          usernameHeader={m.field_email()}
          accounts={accounts.devLogin}
          onUse={onUse}
        />
        {accounts.keycloak && (
          <AccountTable
            caption={m.demo_accounts_keycloak({ realm: accounts.keycloak.realm })}
            usernameHeader={m.demo_accounts_username()}
            accounts={accounts.keycloak.accounts}
          />
        )}
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{m.demo_accounts_note()}</AlertDescription>
        </Alert>
      </CollapsibleContent>
    </Collapsible>
  );
}
