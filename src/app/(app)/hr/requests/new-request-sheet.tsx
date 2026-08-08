"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HR_LEAVE_TYPES,
  HR_REQUEST_KINDS,
  submitHrRequestSchema,
  type SubmitHrRequestInput,
} from "@/lib/validation/hris";

import { submitHrRequestAction } from "./actions";

type FormValues = {
  kind: SubmitHrRequestInput["kind"];
  leave_type: SubmitHrRequestInput["leave_type"] | "";
  start_at: string;
  end_at: string;
  hours_estimate: string;
  reason: string;
  attachment_url: string;
};

function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const DEFAULT_VALUES: FormValues = {
  kind: "LEAVE",
  leave_type: "ANNUAL",
  start_at: localNow(),
  end_at: localNow(),
  hours_estimate: "",
  reason: "",
  attachment_url: "",
};

export function NewHrRequestSheet() {
  const t = useTranslations("hrRequests");
  const tf = useTranslations("hrRequests.form");
  const tKind = useTranslations("hrRequests.kinds");
  const tLeaveType = useTranslations("hrRequests.leaveTypes");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: async (values) => {
      const payload = {
        kind: values.kind,
        leave_type:
          values.kind === "LEAVE" && values.leave_type
            ? values.leave_type
            : undefined,
        start_at: new Date(values.start_at).toISOString(),
        end_at: new Date(values.end_at).toISOString(),
        hours_estimate:
          values.kind === "OVERTIME" && values.hours_estimate
            ? Number(values.hours_estimate)
            : undefined,
        reason: values.reason,
        attachment_url: values.attachment_url || undefined,
      };
      const parsed = submitHrRequestSchema.safeParse(payload);
      if (parsed.success) return { values, errors: {} };
      const errors: Record<string, { type: string; message: string }> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!errors[path]) {
          errors[path] = { type: "validation", message: issue.message };
        }
      }
      return { values: {}, errors };
    },
  });

  const kind = form.watch("kind");

  function onSubmit(values: FormValues) {
    const payload: SubmitHrRequestInput = {
      kind: values.kind,
      leave_type:
        values.kind === "LEAVE" && values.leave_type
          ? values.leave_type
          : undefined,
      start_at: new Date(values.start_at).toISOString(),
      end_at: new Date(values.end_at).toISOString(),
      hours_estimate:
        values.kind === "OVERTIME" && values.hours_estimate
          ? Number(values.hours_estimate)
          : undefined,
      reason: values.reason,
      attachment_url: values.attachment_url || undefined,
    };
    startTransition(async () => {
      const result = await submitHrRequestAction(payload);
      if (result.ok) {
        toast.success(tf("submitted"));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("title")}</SheetTitle>
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("kind")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {field.value ? tKind(field.value) : null}
                        </SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {HR_REQUEST_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {tKind(k)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {kind === "LEAVE" ? (
              <FormField
                control={form.control}
                name="leave_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("leaveType")}</FormLabel>
                    <Select
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.value ? tLeaveType(field.value) : null}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {HR_LEAVE_TYPES.map((lt) => (
                          <SelectItem key={lt} value={lt}>
                            {tLeaveType(lt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="start_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("startAt")}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("endAt")}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {kind === "OVERTIME" ? (
              <FormField
                control={form.control}
                name="hours_estimate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("hoursEstimate")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.25"
                        min={0.25}
                        max={24}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("reason")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder={tf("reasonPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="attachment_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {kind === "SICK" ? tf("doctorNote") : tf("attachment")}
                  </FormLabel>
                  <FormControl>
                    <Input {...field} type="url" placeholder="https://…" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <SheetClose
                render={
                  <Button variant="ghost" type="button" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {tf("submit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
