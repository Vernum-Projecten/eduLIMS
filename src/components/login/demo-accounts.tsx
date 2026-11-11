// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { ChevronDownIcon, InfoIcon, KeyRoundIcon } from "lucide-react";
import { useId } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { m } from "@/i18n/messages";
import { roleLabel } from "@/lib/i18n/labels";
import type { DemoAccount, DemoAccounts } from "@/server/demo-accounts";

/** One group of demo accounts: a heading and hint above a role/account table. */
function AccountGroup({
  title,
  hint,
  accounts,
  onUse,
}: Readonly<{
  title: string;
  hint: string;
  accounts: readonly DemoAccount[];
  onUse?: (account: DemoAccount) => void;
}>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h3 id={headingId} className="text-sm font-medium">
        {title}
      </h3>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <Table aria-labelledby={headingId} className="text-sm">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="w-0 whitespace-nowrap">
              {m.demo_accounts_role()}
            </TableHead>
            <TableHead scope="col">{m.demo_accounts_account()}</TableHead>
            {onUse && (
              <TableHead scope="col" className="w-0">
                <span className="sr-only">{m.demo_accounts_fill_in()}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.username}>
              <TableHead scope="row" className="whitespace-nowrap font-normal">
                {roleLabel(account.role)}
              </TableHead>
              <TableCell className="font-mono text-xs">{account.username}</TableCell>
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
    </section>
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
  const devPassword = accounts.devLogin[0]?.password ?? "";
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
      <CollapsibleContent className="flex flex-col gap-5 px-3 pt-1 pb-3">
        {accounts.keycloak && (
          <AccountGroup
            title={m.demo_accounts_keycloak_title({ realm: accounts.keycloak.realm })}
            hint={m.demo_accounts_keycloak_hint()}
            accounts={accounts.keycloak.accounts}
          />
        )}
        <AccountGroup
          title={m.demo_accounts_dev_login_title()}
          hint={m.demo_accounts_dev_login_hint({ password: devPassword })}
          accounts={accounts.devLogin}
          onUse={onUse}
        />
        <Alert>
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{m.demo_accounts_note()}</AlertDescription>
        </Alert>
      </CollapsibleContent>
    </Collapsible>
  );
}
