import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABEL_EN,
  CHANNEL_LABEL_EN,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  categoryForKind,
} from "./categories";
import type { NotificationKind } from "@/types/database";

describe("notifications/categories", () => {
  it("returns SYSTEM as fallback for unknown kinds", () => {
    // A value that isn't in KIND_CATEGORY but is a valid NotificationKind
    // shape. Casting is safe here — the runtime map handles the miss.
    const unknown = "TOTALLY_MADE_UP_KIND" as NotificationKind;
    expect(categoryForKind(unknown)).toBe("SYSTEM");
  });

  it("maps approvals-adjacent kinds to APPROVALS", () => {
    const kinds: NotificationKind[] = [
      "APPROVAL_REQUESTED",
      "APPROVAL_APPROVED",
      "APPROVAL_REJECTED",
      "EVALUATION_SUBMITTED",
      "UPK_APPROVED",
      "MONTHLY_REPORT_SUBMITTED",
    ];
    for (const k of kinds) {
      expect(categoryForKind(k)).toBe("APPROVALS");
    }
  });

  it("maps financial disbursement/settlement kinds to BUDGETS", () => {
    const kinds: NotificationKind[] = [
      "CASH_ADVANCE_DISBURSED",
      "CASH_ADVANCE_SETTLED",
      "PETTY_CASH_LOW_BALANCE",
      "SETTLEMENT_DUE_SOON",
      "SETTLEMENT_OVERDUE",
      "EXPENSE_DRAFT_STALE",
      "EXPENSE_INCURRED_STALE",
    ];
    for (const k of kinds) {
      expect(categoryForKind(k)).toBe("BUDGETS");
    }
  });

  it("maps timesheet kinds to TIMESHEETS", () => {
    expect(categoryForKind("TIMESHEET_SUBMITTED")).toBe("TIMESHEETS");
    expect(categoryForKind("TIMESHEET_APPROVED")).toBe("TIMESHEETS");
    expect(categoryForKind("TIMESHEET_REJECTED")).toBe("TIMESHEETS");
  });

  it("maps employee lifecycle kinds to EMPLOYEES", () => {
    expect(categoryForKind("EMPLOYEE_CONTRACT_EXPIRING")).toBe("EMPLOYEES");
    expect(categoryForKind("HR_REQUEST_UPDATE")).toBe("EMPLOYEES");
  });

  it("maps SLA / contract kinds to MILESTONES", () => {
    expect(categoryForKind("SLA_BREACH_WARNING")).toBe("MILESTONES");
    expect(categoryForKind("PROJECT_CONTRACT_EXPIRING")).toBe("MILESTONES");
  });

  it("maps project handover to ASSIGNMENTS", () => {
    expect(categoryForKind("PROJECT_HANDOVER")).toBe("ASSIGNMENTS");
  });

  it("has the seven mockup categories in the frozen tuple", () => {
    expect(new Set(NOTIFICATION_CATEGORIES)).toEqual(
      new Set([
        "APPROVALS",
        "BUDGETS",
        "MILESTONES",
        "ASSIGNMENTS",
        "TIMESHEETS",
        "EMPLOYEES",
        "SYSTEM",
      ]),
    );
  });

  it("has the four delivery channels in the frozen tuple", () => {
    expect(new Set(NOTIFICATION_CHANNELS)).toEqual(
      new Set(["IN_APP", "EMAIL", "TELEGRAM", "WHATSAPP"]),
    );
  });

  it("provides an English label for every category and channel", () => {
    for (const cat of NOTIFICATION_CATEGORIES) {
      expect(CATEGORY_LABEL_EN[cat].length).toBeGreaterThan(0);
    }
    for (const ch of NOTIFICATION_CHANNELS) {
      expect(CHANNEL_LABEL_EN[ch].length).toBeGreaterThan(0);
    }
  });
});
