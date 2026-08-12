"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  approveWeeklyTimesheetSchema,
  rejectWeeklyTimesheetSchema,
  type ApproveWeeklyTimesheetInput,
  type RejectWeeklyTimesheetInput,
} from "@/lib/validation/timesheet-week";

import {
  approveWeeklyTimesheetAction,
  rejectWeeklyTimesheetAction,
} from "../actions";

type Labels = {
  approve: string;
  reject: string;
  approveTitle: string;
  approveDescription: string;
  rejectTitle: string;
  rejectDescription: string;
  comment: string;
  commentPlaceholder: string;
  reason: string;
  reasonPlaceholder: string;
  confirmApprove: string;
  confirmReject: string;
  approvedToast: string;
  rejectedToast: string;
};

export function WeeklyReviewButtons({
  id,
  labels,
}: {
  id: string;
  labels: Labels;
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const approveForm = useForm<ApproveWeeklyTimesheetInput>({
    resolver: zodResolver(approveWeeklyTimesheetSchema),
    defaultValues: { id, comment: "" },
  });
  const rejectForm = useForm<RejectWeeklyTimesheetInput>({
    resolver: zodResolver(rejectWeeklyTimesheetSchema),
    defaultValues: { id, reason: "" },
  });

  const onApprove = approveForm.handleSubmit((values) => {
    startTransition(async () => {
      const res = await approveWeeklyTimesheetAction(values);
      if (res.ok) {
        setApproveOpen(false);
        toast.success(labels.approvedToast);
        router.refresh();
      } else {
        toast.error(res.reason ?? "Failed to approve.");
      }
    });
  });

  const onReject = rejectForm.handleSubmit((values) => {
    startTransition(async () => {
      const res = await rejectWeeklyTimesheetAction(values);
      if (res.ok) {
        setRejectOpen(false);
        toast.success(labels.rejectedToast);
        router.refresh();
      } else {
        toast.error(res.reason ?? "Failed to reject.");
      }
    });
  });

  return (
    <div className="flex items-center gap-2 justify-end">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" disabled={isPending} className="gap-1.5">
              <Check className="size-3.5" /> {labels.approve}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.approveTitle}</DialogTitle>
            <DialogDescription>{labels.approveDescription}</DialogDescription>
          </DialogHeader>
          <Form {...approveForm}>
            <form onSubmit={onApprove} className="flex flex-col gap-4">
              <FormField
                control={approveForm.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{labels.comment}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={labels.commentPlaceholder}
                        rows={3}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {labels.confirmApprove}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-rose-400/30 text-rose-300 hover:bg-rose-500/10"
              disabled={isPending}
            >
              <X className="size-3.5" /> {labels.reject}
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.rejectTitle}</DialogTitle>
            <DialogDescription>{labels.rejectDescription}</DialogDescription>
          </DialogHeader>
          <Form {...rejectForm}>
            <form onSubmit={onReject} className="flex flex-col gap-4">
              <FormField
                control={rejectForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{labels.reason}</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder={labels.reasonPlaceholder}
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {labels.confirmReject}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
