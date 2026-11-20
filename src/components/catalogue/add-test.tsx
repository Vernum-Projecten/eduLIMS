// SPDX-FileCopyrightText: Ruben Talstra
// SPDX-License-Identifier: Apache-2.0

import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { TestFormDialog } from "@/components/catalogue/test-form-dialog";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n/messages";

/**
 * The catalogue page's one primary action (#384): "Add test" and its form dialog, which returns
 * focus to the button when it closes (WCAG 2.4.3).
 */
export function AddTest() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={buttonRef} onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        {m.catalogue_add()}
      </Button>
      <TestFormDialog
        control={{
          open,
          onOpenChange: setOpen,
          onCloseAutoFocus: (event) => {
            event.preventDefault();
            buttonRef.current?.focus();
          },
        }}
      />
    </>
  );
}
