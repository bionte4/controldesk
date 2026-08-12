"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  FileSignature,
  Loader2,
  Paperclip,
  Send,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MonthlyReportSectionKind } from "@/lib/validation/monthly-report";

import {
  decideMonthlyReportByPmAction,
  generateBeritaAcaraAction,
  recordClientDecisionAction,
  sendMonthlyReportToClientAction,
  submitMonthlyReportAction,
  upsertMonthlyReportSectionAction,
} from "../actions";
import { uploadMonthlyReportSignatureAction } from "../upload-actions";

type EditSectionProps = {
  mode: "editSection";
  reportId: string;
  projectId: string;
  kind: MonthlyReportSectionKind;
  initialContent: string;
};

/**
 * Workflow props. Boolean flags come pre-computed server-side (RSC page)
 * so the client component never re-implements permission checks —
 * everything ultimately hits the server action + RLS.
 */
type WorkflowProps = {
  mode: "workflow";
  reportId: string;
  projectId: string;
  status: string;
  canSubmit: boolean;
  canDecide: boolean;
  canSendToClient: boolean;
  canRecordClientDecision: boolean;
  canGenerateBa: boolean;
  spvNotes: string | null;
  pmNotes: string | null;
  /** Pre-fill for the client-decision form when the report was already sent. */
  clientEmail: string | null;
  /** Period defaults for the BA generation form. */
  periodMonth: string; // YYYY-MM-DD (first-of-month)
};

type Props = EditSectionProps | WorkflowProps;

export function MonthlyReportActionsPanel(props: Props) {
  if (props.mode === "editSection") return <SectionEditor {...props} />;
  return <WorkflowActions {...props} />;
}

// ---------------------------------------------------------------------
// Section editor — unchanged from Slice A.
// ---------------------------------------------------------------------
function SectionEditor(props: EditSectionProps) {
  const tForm = useTranslations("monthlyReport.form");
  const router = useRouter();
  const [content, setContent] = React.useState(props.initialContent ?? "");
  const [pending, startTransition] = React.useTransition();
  const dirty = content !== (props.initialContent ?? "");

  function save() {
    startTransition(async () => {
      const res = await upsertMonthlyReportSectionAction({
        report_id: props.reportId,
        kind: props.kind,
        content: content.trim() || undefined,
      });
      if (res.ok) {
        toast.success(tForm("saveSection"));
        router.refresh();
      } else {
        toast.error(res.reason ?? "Save failed.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        rows={5}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={tForm("sectionContentPlaceholder")}
        maxLength={8000}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={save}
          disabled={pending || !dirty}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {tForm("saveSection")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Workflow actions — Slice A (submit + PM decide) + Slice B
// (send-to-client, record client decision with optional signature
// upload, generate Berita Acara).
// ---------------------------------------------------------------------
function WorkflowActions(props: WorkflowProps) {
  const t = useTranslations("monthlyReport");
  const tForm = useTranslations("monthlyReport.form");
  const tSb = useTranslations("monthlyReport.sliceB");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // Slice A local state.
  const [spvNotes, setSpvNotes] = React.useState(props.spvNotes ?? "");
  const [pmNotes, setPmNotes] = React.useState(props.pmNotes ?? "");

  // Slice B — send to client.
  const [clientEmail, setClientEmail] = React.useState(
    props.clientEmail ?? "",
  );
  const [sendNotes, setSendNotes] = React.useState("");

  // Slice B — record client decision.
  const [reviewerName, setReviewerName] = React.useState("");
  const [reviewerEmail, setReviewerEmail] = React.useState(
    props.clientEmail ?? "",
  );
  const [decidedAt, setDecidedAt] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [clientNotes, setClientNotes] = React.useState("");
  const [signatureFile, setSignatureFile] = React.useState<File | null>(null);
  const [uploadedSignature, setUploadedSignature] = React.useState<{
    path: string;
    fileName: string;
  } | null>(null);
  const [uploadingSig, setUploadingSig] = React.useState(false);

  // Slice B — BA generation.
  const periodStartDefault = props.periodMonth.slice(0, 10);
  const [baPeriodStart, setBaPeriodStart] = React.useState(periodStartDefault);
  const [baPeriodEnd, setBaPeriodEnd] = React.useState(() => {
    const d = new Date(periodStartDefault);
    // Last day of the same month.
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    );
    return last.toISOString().slice(0, 10);
  });
  const [baNotes, setBaNotes] = React.useState("");

  function submit() {
    startTransition(async () => {
      const res = await submitMonthlyReportAction({
        id: props.reportId,
        spv_notes: spvNotes.trim() || undefined,
      });
      if (res.ok) {
        toast.success(tForm("submitSuccess"));
        router.refresh();
      } else {
        toast.error(res.reason ?? "Submit failed.");
      }
    });
  }

  function decide(decision: "APPROVE" | "RETURN" | "REJECT") {
    if (decision !== "APPROVE" && !pmNotes.trim()) {
      toast.error(tForm("pmNotesPlaceholder"));
      return;
    }
    startTransition(async () => {
      const res = await decideMonthlyReportByPmAction({
        id: props.reportId,
        decision,
        pm_notes: pmNotes.trim() || undefined,
      });
      if (res.ok) {
        toast.success(
          decision === "APPROVE"
            ? tForm("approveSuccess")
            : decision === "RETURN"
              ? tForm("returnSuccess")
              : tForm("rejectSuccess"),
        );
        router.refresh();
      } else {
        toast.error(res.reason ?? "Decision failed.");
      }
    });
  }

  function sendToClient() {
    startTransition(async () => {
      const trimmedEmail = clientEmail.trim();
      const res = await sendMonthlyReportToClientAction({
        id: props.reportId,
        client_email: trimmedEmail || undefined,
        send_notes: sendNotes.trim() || undefined,
      });
      if (res.ok) {
        toast.success(tSb("sendSuccess"));
        router.refresh();
      } else {
        toast.error(res.reason ?? "Send failed.");
      }
    });
  }

  async function uploadSignature() {
    if (!signatureFile) return;
    setUploadingSig(true);
    try {
      const fd = new FormData();
      fd.append("report_id", props.reportId);
      fd.append("file", signatureFile);
      const res = await uploadMonthlyReportSignatureAction(fd);
      if (res.ok) {
        setUploadedSignature({
          path: res.data.storagePath,
          fileName: res.data.fileName,
        });
        toast.success(tSb("signatureUploaded"));
      } else {
        toast.error(res.reason ?? "Upload failed.");
      }
    } finally {
      setUploadingSig(false);
    }
  }

  function recordClient(decision: "APPROVE" | "REJECT") {
    if (!reviewerName.trim()) {
      toast.error(tSb("reviewerNameRequired"));
      return;
    }
    if (decision === "REJECT" && !clientNotes.trim()) {
      toast.error(tSb("rejectNotesRequired"));
      return;
    }
    startTransition(async () => {
      const res = await recordClientDecisionAction({
        id: props.reportId,
        decision,
        reviewer_name: reviewerName.trim(),
        reviewer_email: reviewerEmail.trim() || undefined,
        decided_at: decidedAt || undefined,
        notes: clientNotes.trim() || undefined,
        signature_path: uploadedSignature?.path ?? null,
        signature_file_name: uploadedSignature?.fileName ?? null,
      });
      if (res.ok) {
        toast.success(
          decision === "APPROVE"
            ? tSb("clientApproveSuccess")
            : tSb("clientRejectSuccess"),
        );
        router.refresh();
      } else {
        toast.error(res.reason ?? "Action failed.");
      }
    });
  }

  function generateBa() {
    if (baPeriodEnd < baPeriodStart) {
      toast.error(tSb("periodInvalid"));
      return;
    }
    startTransition(async () => {
      const res = await generateBeritaAcaraAction({
        id: props.reportId,
        period_start: baPeriodStart || undefined,
        period_end: baPeriodEnd || undefined,
        ba_notes: baNotes.trim() || undefined,
      });
      if (res.ok) {
        toast.success(
          tSb("baGeneratedSuccess", { ba: res.data.ba_number }),
        );
        router.refresh();
      } else {
        toast.error(res.reason ?? "BA generation failed.");
      }
    });
  }

  const showSpvBox = props.canSubmit;
  const showPmBox = props.canDecide;
  const showSendBox = props.canSendToClient;
  const showClientBox = props.canRecordClientDecision;
  const showBaBox = props.canGenerateBa;

  const anyActionable =
    showSpvBox || showPmBox || showSendBox || showClientBox || showBaBox;

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Slice A — SPV submit */}
        {showSpvBox ? (
          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {tForm("spvNotes")}
            </label>
            <Textarea
              rows={3}
              value={spvNotes}
              onChange={(e) => setSpvNotes(e.target.value)}
              placeholder={tForm("spvNotesPlaceholder")}
              maxLength={4000}
            />
            <Button onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {tForm("submit")}
            </Button>
          </div>
        ) : null}

        {/* Slice A — PM decide */}
        {showPmBox ? (
          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">
              {tForm("pmNotes")}
            </label>
            <Textarea
              rows={3}
              value={pmNotes}
              onChange={(e) => setPmNotes(e.target.value)}
              placeholder={tForm("pmNotesPlaceholder")}
              maxLength={4000}
            />
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                onClick={() => decide("APPROVE")}
                disabled={pending}
              >
                {tForm("approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide("RETURN")}
                disabled={pending}
              >
                {tForm("return")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => decide("REJECT")}
                disabled={pending}
              >
                {tForm("reject")}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Slice B — Send to client */}
        {showSendBox ? (
          <div className="grid gap-2 border-t pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Send className="size-4" />
              <span>{tSb("sendTitle")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {tSb("sendHint")}
            </p>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">
                {tSb("clientEmail")}
              </label>
              <Input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="client@example.com"
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">
                {tSb("sendNotes")}
              </label>
              <Textarea
                rows={2}
                value={sendNotes}
                onChange={(e) => setSendNotes(e.target.value)}
                placeholder={tSb("sendNotesPlaceholder")}
                maxLength={1000}
              />
            </div>
            <Button size="sm" onClick={sendToClient} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {tSb("sendAction")}
            </Button>
          </div>
        ) : null}

        {/* Slice B — Record client decision */}
        {showClientBox ? (
          <div className="grid gap-2 border-t pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileSignature className="size-4" />
              <span>{tSb("clientTitle")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {tSb("clientHint")}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {tSb("reviewerName")}
                </label>
                <Input
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  placeholder="Nama PIC klien"
                  maxLength={160}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {tSb("reviewerEmail")}
                </label>
                <Input
                  type="email"
                  value={reviewerEmail}
                  onChange={(e) => setReviewerEmail(e.target.value)}
                  placeholder="pic@client.com"
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {tSb("decidedAt")}
                </label>
                <Input
                  type="date"
                  value={decidedAt}
                  onChange={(e) => setDecidedAt(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {tSb("signature")}
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => {
                      setUploadedSignature(null);
                      setSignatureFile(e.target.files?.[0] ?? null);
                    }}
                    className="text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={uploadSignature}
                    disabled={!signatureFile || uploadingSig}
                  >
                    {uploadingSig ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                    {tSb("uploadSignature")}
                  </Button>
                </div>
                {uploadedSignature ? (
                  <p className="text-[11px] text-emerald-600 truncate">
                    ✓ {uploadedSignature.fileName}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">
                {tSb("clientNotes")}
              </label>
              <Textarea
                rows={2}
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
                placeholder={tSb("clientNotesPlaceholder")}
                maxLength={4000}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                onClick={() => recordClient("APPROVE")}
                disabled={pending}
              >
                <CheckCircle2 className="size-4" />
                {tSb("clientApprove")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => recordClient("REJECT")}
                disabled={pending}
              >
                <XCircle className="size-4" />
                {tSb("clientReject")}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Slice B — Generate BA */}
        {showBaBox ? (
          <div className="grid gap-2 border-t pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileSignature className="size-4" />
              <span>{tSb("baTitle")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {tSb("baHint")}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {tSb("baPeriodStart")}
                </label>
                <Input
                  type="date"
                  value={baPeriodStart}
                  onChange={(e) => setBaPeriodStart(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">
                  {tSb("baPeriodEnd")}
                </label>
                <Input
                  type="date"
                  value={baPeriodEnd}
                  onChange={(e) => setBaPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-1">
              <label className="text-xs text-muted-foreground">
                {tSb("baNotes")}
              </label>
              <Textarea
                rows={2}
                value={baNotes}
                onChange={(e) => setBaNotes(e.target.value)}
                placeholder={tSb("baNotesPlaceholder")}
                maxLength={4000}
              />
            </div>
            <Button size="sm" onClick={generateBa} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileSignature className="size-4" />
              )}
              {tSb("baGenerate")}
            </Button>
          </div>
        ) : null}

        {!anyActionable ? (
          <p className="text-xs text-muted-foreground">
            No actions available for this status.
          </p>
        ) : null}

        {props.spvNotes ? (
          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground">
              {tForm("spvNotes")}
            </div>
            <p className="text-sm whitespace-pre-wrap">{props.spvNotes}</p>
          </div>
        ) : null}
        {props.pmNotes ? (
          <div className="border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground">
              {tForm("pmNotes")}
            </div>
            <p className="text-sm whitespace-pre-wrap">{props.pmNotes}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
