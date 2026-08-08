import "server-only";

import type { ImportAdapter, ImportResource } from "../types";

import { budgetLineAdapter } from "./budget-line";
import { clientAdapter } from "./client";
import { employeeAdapter } from "./employee";
import { projectAdapter } from "./project";

// Registry — the runtime engine indexes into this by resource enum.
// Adding a new adapter = extend `import_job_resource` enum in the DB,
// add the string to `ImportResource`, and register here.
export const IMPORT_ADAPTERS: Record<
  ImportResource,
  ImportAdapter
> = {
  EMPLOYEE: employeeAdapter as unknown as ImportAdapter,
  CLIENT: clientAdapter as unknown as ImportAdapter,
  PROJECT: projectAdapter as unknown as ImportAdapter,
  BUDGET_LINE: budgetLineAdapter as unknown as ImportAdapter,
};

export function getImportAdapter(resource: ImportResource): ImportAdapter {
  return IMPORT_ADAPTERS[resource];
}
