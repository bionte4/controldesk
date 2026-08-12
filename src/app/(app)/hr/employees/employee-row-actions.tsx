"use client";

import * as React from "react";
import { MoreHorizontal, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  EmployeeUpsertSheet,
  type ExistingEmployee,
  type ManagerOption,
} from "./employee-upsert-sheet";

/**
 * Per-row action menu for `/hr/employees`. Exposes the "Edit" entry
 * point that drives the upsert sheet in edit mode.
 *
 * The sheet lives inside this component (not the parent RSC page)
 * because RHF + zod state must reset per-row when the user reopens the
 * menu on a different employee. Hoisting the sheet to the page-level
 * would either (a) require a global "which row is being edited" store,
 * or (b) always mount every row's sheet — both of which waste render
 * effort on rosters with hundreds of employees. Colocating keeps the
 * sheet mount tied to the row it belongs to.
 *
 * We only render one dropdown item today (Edit); the availability
 * toggle already has its own PDP-scoped action that HR/OM triggers via
 * a different surface. When the delete-employee flow lands (backend
 * currently only exposes soft-inactivate via `setEmployeeAvailabilityAction`)
 * this file is the natural home for the new menu item.
 */
export function EmployeeRowActions({
  row,
  departmentOptions,
  positionOptions,
  managerOptions,
}: {
  row: ExistingEmployee;
  departmentOptions: readonly string[];
  positionOptions: readonly string[];
  managerOptions: readonly ManagerOption[];
}) {
  const t = useTranslations("employees.form");
  const [editOpen, setEditOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("rowActions")}
              className="size-8"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil className="mr-2 size-4" /> {t("edit")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EmployeeUpsertSheet
        existing={row}
        departmentOptions={departmentOptions}
        positionOptions={positionOptions}
        managerOptions={managerOptions}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  );
}
