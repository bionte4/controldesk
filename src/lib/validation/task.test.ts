import { describe, expect, it } from "vitest";

import {
  createTaskSchema,
  deleteTaskSchema,
  reorderTaskSchema,
  setTaskProgressSchema,
  setTaskStatusSchema,
  taskStatusSchema,
  updateTaskSchema,
} from "./task";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";

describe("taskStatusSchema", () => {
  it("accepts all canonical states", () => {
    for (const s of [
      "TODO",
      "IN_PROGRESS",
      "BLOCKED",
      "REVIEW",
      "DONE",
      "CANCELLED",
    ] as const) {
      expect(taskStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rejects unknown state", () => {
    expect(taskStatusSchema.safeParse("SOMETHING").success).toBe(false);
  });
});

describe("createTaskSchema", () => {
  it("accepts minimum required (project_id + name)", () => {
    const parsed = createTaskSchema.safeParse({
      project_id: uuid,
      name: "Design DB schema",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Design DB schema");
    }
  });

  it("rejects blank name", () => {
    expect(
      createTaskSchema.safeParse({ project_id: uuid, name: " " }).success,
    ).toBe(false);
  });

  it("rejects too-short name", () => {
    expect(
      createTaskSchema.safeParse({ project_id: uuid, name: "A" }).success,
    ).toBe(false);
  });

  it("rejects planned end before start", () => {
    const parsed = createTaskSchema.safeParse({
      project_id: uuid,
      name: "Bad range",
      planned_start_date: "2026-08-10",
      planned_end_date: "2026-08-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts equal start / end (single-day task)", () => {
    const parsed = createTaskSchema.safeParse({
      project_id: uuid,
      name: "Same-day",
      planned_start_date: "2026-08-10",
      planned_end_date: "2026-08-10",
    });
    expect(parsed.success).toBe(true);
  });

  it("clamps progress to 0-100", () => {
    expect(
      createTaskSchema.safeParse({
        project_id: uuid,
        name: "Off-range",
        progress_pct: 101,
      }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({
        project_id: uuid,
        name: "Negative",
        progress_pct: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts full valid payload with parent + milestone + dependency", () => {
    const parsed = createTaskSchema.safeParse({
      project_id: uuid,
      parent_task_id: uuid2,
      milestone_id: uuid,
      depends_on_task_id: uuid2,
      name: "Complete example",
      description: "  With trimmed description  ",
      status: "TODO",
      progress_pct: 25.5,
      weight_pct: 30,
      planned_start_date: "2026-08-01",
      planned_end_date: "2026-08-15",
      owner_employee_id: uuid,
      budget_amount: 5_000_000,
      sort_order: 2,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.description).toBe("With trimmed description");
    }
  });

  it("rejects non-integer weight decimals beyond 2 places", () => {
    const parsed = createTaskSchema.safeParse({
      project_id: uuid,
      name: "Decimal weight",
      weight_pct: 12.345,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("accepts partial update with only id", () => {
    const parsed = updateTaskSchema.safeParse({ id: uuid });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid actual date range", () => {
    const parsed = updateTaskSchema.safeParse({
      id: uuid,
      actual_start_date: "2026-08-10",
      actual_end_date: "2026-08-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("permits nulling out an owner", () => {
    const parsed = updateTaskSchema.safeParse({
      id: uuid,
      owner_employee_id: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("permits nulling budget_amount", () => {
    const parsed = updateTaskSchema.safeParse({
      id: uuid,
      budget_amount: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("setTaskStatusSchema", () => {
  it("accepts valid transitions", () => {
    expect(
      setTaskStatusSchema.safeParse({ id: uuid, status: "IN_PROGRESS" })
        .success,
    ).toBe(true);
  });
  it("rejects unknown status", () => {
    expect(
      setTaskStatusSchema.safeParse({ id: uuid, status: "MAYBE" }).success,
    ).toBe(false);
  });
});

describe("setTaskProgressSchema", () => {
  it("accepts 0..100", () => {
    for (const v of [0, 25, 50, 75, 100]) {
      expect(setTaskProgressSchema.safeParse({ id: uuid, progress_pct: v }).success)
        .toBe(true);
    }
  });
  it("rejects out-of-range", () => {
    expect(
      setTaskProgressSchema.safeParse({ id: uuid, progress_pct: 101 }).success,
    ).toBe(false);
    expect(
      setTaskProgressSchema.safeParse({ id: uuid, progress_pct: -0.5 }).success,
    ).toBe(false);
  });
});

describe("reorderTaskSchema", () => {
  it("accepts valid reparent + reorder", () => {
    const parsed = reorderTaskSchema.safeParse({
      id: uuid,
      new_parent_task_id: uuid2,
      new_sort_order: 3,
    });
    expect(parsed.success).toBe(true);
  });
  it("accepts null parent (promote to root)", () => {
    const parsed = reorderTaskSchema.safeParse({
      id: uuid,
      new_parent_task_id: null,
      new_sort_order: 0,
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects negative sort_order", () => {
    expect(
      reorderTaskSchema.safeParse({ id: uuid, new_sort_order: -1 }).success,
    ).toBe(false);
  });
});

describe("deleteTaskSchema", () => {
  it("rejects missing id", () => {
    expect(deleteTaskSchema.safeParse({}).success).toBe(false);
  });
  it("rejects malformed uuid", () => {
    expect(deleteTaskSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
