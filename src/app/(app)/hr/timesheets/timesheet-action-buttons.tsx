"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
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
  approveTimesheetSchema,
  rejectTimesheetSchema,
  type ApproveTimesheetInput,
  type RejectTimesheetInput,
} from "@/lib/validation/hr-schedule";

import { approveTimesheetAction, rejectTimesheetAction } from "./actions";

export function TimesheetActionButtons({ id }: { id: string }) {
  const t = useTranslations("timesheets.actions");
  const [isPending, startTransition] = React.useTransition();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const approveForm = useForm<ApproveTimesheetInput>({
    resolver: zodResolver(approveTimesheetSchema),
    defaultValues: { id, comment: "" },
  });
  const rejectForm = useForm<RejectTimesheetInput>({
    resolver: zodResolver(rejectTimesheetSchema),
    defaultValues: { id, reason: "" },
  });

  const onApprove = approveForm.handleSubmit((values) => {
    startTransition(async () => {
      const res = await approveTimesheetAction(values);
      if (res.ok) {
        toast.success(t("approvedToast"));
        setApproveOpen(false);
      } else {
        toast.error(res.reason ?? "Failed");
      }
    });
  });

  const onReject = rejectForm.handleSubmit((values) => {
    startTransition(async () => {
      const res = await rejectTimesheetAction(values);
      if (res.ok) {
        toast.success(t("rejectedToast"));
        setRejectOpen(false);
      } else {
        toast.error(res.reason ?? "Failed");
      }
    });
  });

  return (
    <div className="flex items-center gap-2">
      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" className="gap-1.5">
              <Check className="size-3.5" />
              {t("approve")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("approveTitle")}</DialogTitle>
            <DialogDescription>{t("approveDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...approveForm}>
            <form onSubmit={onApprove} className="flex flex-col gap-4">
              <FormField
                control={approveForm.control}
                name="comment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("comment")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder={t("commentPlaceholder")}
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
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t("approve")}
                    </>
                  ) : (
                    t("confirmApprove")
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogTrigger
          render={
            <Button size="sm" variant="ghost" className="gap-1.5 text-rose-300">
              <X className="size-3.5" />
              {t("reject")}
            </Button>
          }
        />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectDescription")}</DialogDescription>
          </DialogHeader>
          <Form {...rejectForm}>
            <form onSubmit={onReject} className="flex flex-col gap-4">
              <FormField
                control={rejectForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("reason")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        placeholder={t("reasonPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isPending}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      {t("reject")}
                    </>
                  ) : (
                    t("confirmReject")
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
