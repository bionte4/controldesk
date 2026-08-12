/**
 * ControlDesk — business-days arithmetic (rules §18).
 *
 * Business days = Senin sampai Jumat di zona waktu tenant. Sabtu, Minggu, dan
 * hari libur tenant di-skip. Fungsi bersifat pure supaya mudah di-unit-test
 * dan dipakai di client + server.
 *
 * Implementasi memakai `Intl.DateTimeFormat` dengan opsi `timeZone` supaya
 * hasilnya konsisten di runtime dengan TZ manapun (CI di UTC, dev di WIB,
 * dsb). `date-fns-tz.toZonedTime` sengaja tidak dipakai untuk perhitungan
 * hari — behavior-nya "no-op" saat system TZ == target TZ, tapi kita perlu
 * result yang identik lintas sistem.
 *
 * Semua fungsi menerima `Date | ISO string | epoch ms` dan mengembalikan
 * `Date` UTC (kompatibel dengan `timestamptz`).
 *
 * Contract penting:
 *   - `addBusinessDays(d, 0)` mengembalikan akhir hari (23:59:59.999) di
 *     zona waktu tenant untuk tanggal yang sama dengan `d`.
 *   - `diffBusinessDays(from, to)` positif kalau `to > from`, negatif kalau
 *     `to < from`; menghitung berapa hari kerja penuh yang lewat, tidak
 *     termasuk `from` sendiri.
 *   - `businessDaysUntil(target, now)` = `diffBusinessDays(now, target)`.
 */

import { fromZonedTime } from "date-fns-tz";

import { DEFAULT_TIMEZONE, type Formattable } from "./date";

function toDate(value: Formattable): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return new Date(value);
}

type DateParts = {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
  weekday: string; // "Mon" | "Tue" | ...
};

function partsInTz(d: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    y: Number.parseInt(get("year"), 10),
    m: Number.parseInt(get("month"), 10),
    d: Number.parseInt(get("day"), 10),
    weekday: get("weekday"),
  };
}

function isBusinessDayInTz(d: Date, timezone: string): boolean {
  const wd = partsInTz(d, timezone).weekday;
  return wd !== "Sat" && wd !== "Sun";
}

/**
 * Return `Date` UTC yang merepresentasikan `yyyy-MM-dd` di zona waktu tenant,
 * pukul 00:00:00.000 wall-clock. Berguna untuk membakukan input yang
 * mungkin `date-only` string (`incurred_on`) atau `timestamptz`.
 */
function startOfDayInTz(d: Date, timezone: string): Date {
  const { y, m, d: day } = partsInTz(d, timezone);
  const iso = `${y.toString().padStart(4, "0")}-${m
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}T00:00:00`;
  return fromZonedTime(iso, timezone);
}

/**
 * Return `Date` UTC yang merepresentasikan `yyyy-MM-dd` di zona waktu tenant,
 * pukul 23:59:59.999 wall-clock. Dipakai sebagai deadline eksplisit.
 */
function endOfDayInTz(d: Date, timezone: string): Date {
  const { y, m, d: day } = partsInTz(d, timezone);
  const iso = `${y.toString().padStart(4, "0")}-${m
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}T23:59:59.999`;
  return fromZonedTime(iso, timezone);
}

/**
 * Tambah `n` hari kerja ke `date`. `n` boleh negatif (mundur).
 *
 * Aturan:
 *   - Kalau `n = 0`, kembalikan akhir hari (23:59:59.999) di zona waktu
 *     tenant untuk tanggal yang sama dengan `date`.
 *   - Iterasi hari-per-hari; hanya hari kerja (Sen–Jum) yang dihitung.
 *   - Hari awal `date` tidak dihitung; iterasi mulai dari hari berikutnya
 *     (atau sebelumnya kalau `n < 0`).
 *   - Hasil dikembalikan sebagai akhir hari (23:59:59.999) di zona waktu
 *     tenant, sehingga bisa langsung dibandingkan dengan `now`.
 */
export function addBusinessDays(
  date: Formattable,
  n: number,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  const start = toDate(date);
  if (!Number.isFinite(n)) {
    throw new Error("addBusinessDays: n must be a finite number");
  }
  if (n === 0) return endOfDayInTz(start, timezone);

  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(n));
  let cursor = startOfDayInTz(start, timezone);

  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + step * 24 * 60 * 60 * 1000);
    if (isBusinessDayInTz(cursor, timezone)) {
      remaining -= 1;
    }
  }

  return endOfDayInTz(cursor, timezone);
}

/**
 * Return berapa hari kerja PENUH yang lewat dari `from` ke `to`, di zona
 * waktu tenant. Positif kalau `to > from`, negatif kalau `to < from`.
 *
 * Weekend tidak ikut dihitung. Hari awal (`from`) tidak ikut dihitung.
 * Hari akhir (`to`) ikut dihitung kalau jatuh di hari kerja.
 *
 * Contoh (WIB):
 *   - Jumat 08:00 → Senin 08:00 = 1 (Senin dihitung, Sabtu/Minggu di-skip).
 *   - Senin → Jumat minggu yg sama = 4.
 *   - Senin → Senin minggu berikutnya = 5.
 */
export function diffBusinessDays(
  from: Formattable,
  to: Formattable,
  timezone: string = DEFAULT_TIMEZONE,
): number {
  const a = startOfDayInTz(toDate(from), timezone);
  const b = startOfDayInTz(toDate(to), timezone);
  if (a.getTime() === b.getTime()) return 0;

  const forward = b.getTime() > a.getTime();
  const step = forward ? 1 : -1;
  let cursor = new Date(a.getTime());
  let count = 0;

  while (cursor.getTime() !== b.getTime()) {
    cursor = new Date(cursor.getTime() + step * 24 * 60 * 60 * 1000);
    if (isBusinessDayInTz(cursor, timezone)) {
      count += step;
    }
  }

  return count;
}

/**
 * Hitung berapa hari kerja menuju `target`, relatif ke `now`. Positif kalau
 * `target` masih di depan, negatif kalau sudah lewat (overdue).
 */
export function businessDaysUntil(
  target: Formattable,
  now: Formattable = new Date(),
  timezone: string = DEFAULT_TIMEZONE,
): number {
  return diffBusinessDays(now, target, timezone);
}

/**
 * Return `true` kalau `date` jatuh di hari kerja (Senin–Jumat) di zona
 * waktu tenant. Utility publik untuk validasi form.
 */
export function isBusinessDay(
  date: Formattable,
  timezone: string = DEFAULT_TIMEZONE,
): boolean {
  return isBusinessDayInTz(toDate(date), timezone);
}
