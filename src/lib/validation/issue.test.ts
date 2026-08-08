import { describe, expect, it } from "vitest";

import {
  ISSUE_CATEGORY_VALUES,
  assignIssueSchema,
  closeIssueSchema,
  commentIssueSchema,
  createIssueSchema,
  issueCategorySchema,
  issueSeveritySchema,
  issueStatusSchema,
  transitionIssueSchema,
  updateIssueSchema,
} from "./issue";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";

describe("issue Zod schemas", () => {
  it("severity accepts CRITICAL / HIGH / MEDIUM / LOW", () => {
    for (const s of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
      expect(() => issueSeveritySchema.parse(s)).not.toThrow();
    }
    expect(() => issueSeveritySchema.parse("URGENT")).toThrow();
  });

  it("status accepts the full lifecycle", () => {
    for (const s of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "REOPENED"]) {
      expect(() => issueStatusSchema.parse(s)).not.toThrow();
    }
    expect(() => issueStatusSchema.parse("DEFERRED")).toThrow();
  });

  it("createIssueSchema defaults severity=MEDIUM, description='', category=BUG, tags=[]", () => {
    const parsed = createIssueSchema.parse({
      project_id: UUID_A,
      title: "Login broken",
    });
    expect(parsed.severity).toBe("MEDIUM");
    expect(parsed.description).toBe("");
    expect(parsed.category).toBe("BUG");
    expect(parsed.tags).toEqual([]);
    expect(parsed.milestone_id).toBeUndefined();
    expect(parsed.due_date).toBeUndefined();
    expect(parsed.notes).toBeUndefined();
  });

  it("category schema accepts all seven ORM-style categories", () => {
    for (const c of ISSUE_CATEGORY_VALUES) {
      expect(() => issueCategorySchema.parse(c)).not.toThrow();
    }
    expect(() => issueCategorySchema.parse("BLOCKER")).toThrow();
  });

  it("createIssueSchema normalises + de-duplicates tags to lowercase", () => {
    const parsed = createIssueSchema.parse({
      project_id: UUID_A,
      title: "Slow query",
      tags: [" Checkout ", "checkout", "BACKEND", "backend"],
    });
    expect(parsed.tags).toEqual(["checkout", "backend"]);
  });

  it("createIssueSchema rejects > 20 tags", () => {
    expect(() =>
      createIssueSchema.parse({
        project_id: UUID_A,
        title: "Load test spike",
        tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
      }),
    ).toThrow();
  });

  it("createIssueSchema accepts optional milestone_id + due_date + notes", () => {
    const parsed = createIssueSchema.parse({
      project_id: UUID_A,
      title: "Milestone risk",
      milestone_id: UUID_B,
      due_date: "2026-12-01",
      notes: "Escalate at next standup",
    });
    expect(parsed.milestone_id).toBe(UUID_B);
    expect(parsed.due_date).toBe("2026-12-01");
    expect(parsed.notes).toBe("Escalate at next standup");
  });

  it("createIssueSchema rejects blank title", () => {
    expect(() =>
      createIssueSchema.parse({
        project_id: UUID_A,
        title: "   ",
      }),
    ).toThrow();
  });

  it("createIssueSchema rejects title over 256 chars", () => {
    expect(() =>
      createIssueSchema.parse({
        project_id: UUID_A,
        title: "x".repeat(300),
      }),
    ).toThrow();
  });

  it("createIssueSchema accepts optional assignee_employee_id", () => {
    const parsed = createIssueSchema.parse({
      project_id: UUID_A,
      title: "DB timeout",
      severity: "HIGH",
      assignee_employee_id: UUID_B,
    });
    expect(parsed.assignee_employee_id).toBe(UUID_B);
    expect(parsed.severity).toBe("HIGH");
  });

  it("updateIssueSchema requires at least one mutable field", () => {
    expect(() =>
      updateIssueSchema.parse({ issue_id: UUID_A }),
    ).toThrow();
  });

  it("updateIssueSchema accepts assignee_employee_id=null (unassign)", () => {
    const parsed = updateIssueSchema.parse({
      issue_id: UUID_A,
      assignee_employee_id: null,
    });
    expect(parsed.assignee_employee_id).toBeNull();
  });

  it("updateIssueSchema accepts patching category/milestone/due_date/tags/notes independently", () => {
    expect(() =>
      updateIssueSchema.parse({
        issue_id: UUID_A,
        category: "INCIDENT",
      }),
    ).not.toThrow();
    expect(() =>
      updateIssueSchema.parse({ issue_id: UUID_A, milestone_id: null }),
    ).not.toThrow();
    expect(() =>
      updateIssueSchema.parse({ issue_id: UUID_A, due_date: null }),
    ).not.toThrow();
    expect(() =>
      updateIssueSchema.parse({
        issue_id: UUID_A,
        tags: ["deploy", "ops"],
      }),
    ).not.toThrow();
    expect(() =>
      updateIssueSchema.parse({
        issue_id: UUID_A,
        notes: "reassigned to L2",
      }),
    ).not.toThrow();
  });

  it("transitionIssueSchema accepts every terminal + intermediate status", () => {
    for (const s of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "REOPENED"]) {
      expect(() =>
        transitionIssueSchema.parse({ issue_id: UUID_A, to_status: s }),
      ).not.toThrow();
    }
  });

  it("commentIssueSchema requires non-empty text", () => {
    expect(() =>
      commentIssueSchema.parse({ issue_id: UUID_A, comment: "   " }),
    ).toThrow();
    const parsed = commentIssueSchema.parse({
      issue_id: UUID_A,
      comment: "Trying restart of the app pool",
    });
    expect(parsed.comment).toBe("Trying restart of the app pool");
  });

  it("assignIssueSchema requires UUID or null", () => {
    expect(() =>
      assignIssueSchema.parse({
        issue_id: UUID_A,
        assignee_employee_id: UUID_B,
      }),
    ).not.toThrow();
    expect(() =>
      assignIssueSchema.parse({
        issue_id: UUID_A,
        assignee_employee_id: null,
      }),
    ).not.toThrow();
    expect(() =>
      assignIssueSchema.parse({
        issue_id: UUID_A,
        assignee_employee_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("closeIssueSchema accepts optional comment", () => {
    expect(() =>
      closeIssueSchema.parse({ issue_id: UUID_A }),
    ).not.toThrow();
    expect(() =>
      closeIssueSchema.parse({
        issue_id: UUID_A,
        comment: "Fixed in v1.2.4 hotfix.",
      }),
    ).not.toThrow();
  });
});
