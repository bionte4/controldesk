import { describe, expect, it } from "vitest";

import {
  assignIssueSchema,
  closeIssueSchema,
  commentIssueSchema,
  createIssueSchema,
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

  it("createIssueSchema defaults severity=MEDIUM and description=''", () => {
    const parsed = createIssueSchema.parse({
      project_id: UUID_A,
      title: "Login broken",
    });
    expect(parsed.severity).toBe("MEDIUM");
    expect(parsed.description).toBe("");
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
