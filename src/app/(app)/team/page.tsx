import { redirect } from "next/navigation";

/**
 * Legacy `/team` route.
 *
 * The staff directory lives at `/hr/employees` (People > Karyawan) as of the
 * Employees module. We keep this file so old bookmarks and inbound links to
 * `/team` still resolve — a 307 redirect points visitors at the current page
 * instead of the "coming soon" catch-all.
 */
export default function TeamRedirectPage(): never {
  redirect("/hr/employees");
}
