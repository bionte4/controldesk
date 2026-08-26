import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleCheckBig,
  Headphones,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Paket & Harga",
  description:
    "Paket ControlDesk untuk project operations, field spend control, dan managed services.",
};

const plans = [
  {
    name: "Field Starter",
    description: "Kontrol operasional lapangan untuk tim yang mulai meninggalkan spreadsheet dan chat.",
    price: "Rp2–3 juta",
    suffix: "/bulan",
    audience: "Hingga 30 pengguna aktif dan 10 proyek aktif",
    features: [
      "Project control dan assignment engineer",
      "Cash advance dan settlement lapangan",
      "Approval berjenjang",
      "Timesheet dasar",
      "Audit trail operasional",
    ],
    cta: "Mulai workspace",
    featured: false,
  },
  {
    name: "Managed Services",
    description: "Visibilitas delivery, kapasitas tim, dan layanan klien dalam satu workspace.",
    price: "Rp4–6 juta",
    suffix: "/bulan",
    audience: "Hingga 100 pengguna aktif",
    features: [
      "Semua fitur Field Starter",
      "Issue, severity, SLA, dan escalation",
      "Resource allocation dan utilization",
      "Portal klien",
      "Reporting dan priority support",
    ],
    cta: "Pilih Managed Services",
    featured: true,
  },
  {
    name: "Service Enterprise",
    description: "Governance, keamanan, dan integrasi untuk kebutuhan organisasi berskala besar.",
    price: "Rp8–12 juta",
    suffix: "/bulan",
    audience: "Limit pengguna dan proyek sesuai kontrak",
    features: [
      "Semua fitur Managed Services",
      "SSO dan kebijakan sesi enterprise",
      "Custom approval workflow",
      "Integration support",
      "Retention dan SLA support kontraktual",
    ],
    cta: "Diskusikan kebutuhan",
    featured: false,
  },
] as const;

const faqs = [
  [
    "Apakah harga sudah final?",
    "Belum. Harga di halaman ini adalah kisaran indikatif dan akan dikonfirmasi setelah kebutuhan, jumlah pengguna aktif, proyek, serta integrasi dipetakan.",
  ],
  [
    "Apakah ada biaya implementasi?",
    "Ya. Implementasi Basic berkisar Rp5–10 juta dan Advanced Rp15–30 juta. Migrasi data atau integrasi khusus menggunakan quotation terpisah.",
  ],
  [
    "Bagaimana model perhitungannya?",
    "ControlDesk menggunakan base platform fee ditambah tier pengguna aktif dan implementation fee, bukan biaya per-seat murni.",
  ],
  [
    "Bisakah mencoba melalui pilot?",
    "Bisa. Paid pilot 60 hari mencakup satu divisi, maksimal dua proyek, 20–40 pengguna, satu workflow cash advance, training, dan review adopsi mingguan.",
  ],
] as const;

export default function PricingPage() {
  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(circle_at_top,oklch(from_var(--primary)_l_c_h/0.18),transparent_65%)]" />

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Logo size={32} />
          ControlDesk
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
            Beranda
          </Button>
          <LanguageToggle />
          <ThemeToggle />
          <Button size="sm" nativeButton={false} render={<Link href="/login" />}>
            Masuk
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center sm:pt-28">
          <Badge variant="secondary" className="gap-1.5">
            <Sparkles className="size-3.5 text-primary" />
            Harga transparan untuk tahap awal
          </Badge>
          <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight sm:text-6xl">
            Paket yang tumbuh bersama
            <span className="block bg-gradient-to-r from-primary via-chart-2 to-chart-3 bg-clip-text text-transparent">
              operasi layanan Anda
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Mulai dari kontrol pekerjaan lapangan, lalu perluas ke SLA, portal klien,
            integrasi, dan governance enterprise tanpa memindahkan data ke platform lain.
          </p>
          <p className="mt-3 text-sm font-medium text-primary">
            Seluruh harga belum termasuk pajak dan merupakan estimasi awal.
          </p>
        </section>

        <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-20 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`relative flex flex-col rounded-3xl border p-7 shadow-sm ${
                plan.featured
                  ? "border-primary bg-primary/[0.04] shadow-primary/10 ring-1 ring-primary"
                  : "border-border/70 bg-card/80"
              }`}
            >
              {plan.featured && (
                <Badge className="absolute -top-3 left-7">Paling sesuai untuk MSP</Badge>
              )}
              <h2 className="font-display text-2xl font-semibold">{plan.name}</h2>
              <p className="mt-3 min-h-16 text-sm leading-6 text-muted-foreground">
                {plan.description}
              </p>
              <div className="mt-7 flex items-end gap-1">
                <span className="font-display text-3xl font-semibold tracking-tight">{plan.price}</span>
                <span className="pb-1 text-sm text-muted-foreground">{plan.suffix}</span>
              </div>
              <p className="mt-2 text-sm font-medium">{plan.audience}</p>
              <div className="my-6 h-px bg-border" />
              <ul className="flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-8 w-full"
                variant={plan.featured ? "default" : "outline"}
                nativeButton={false}
                render={<Link href="/register-org" />}
              >
                {plan.cta}
                <ArrowRight className="size-4" />
              </Button>
            </article>
          ))}
        </section>

        <section className="border-y border-border/70 bg-muted/35">
          <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <Badge variant="outline">Paid pilot 60 hari</Badge>
              <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Buktikan hasilnya pada proses nyata
              </h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Jalankan satu workflow prioritas bersama tim kami sebelum mengambil komitmen lebih luas.
                Kisaran investasi pilot Rp10–15 juta.
              </p>
              <Button className="mt-7" nativeButton={false} render={<Link href="/register-org" />}>
                Ajukan paid pilot
                <ArrowRight className="size-4" />
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                [CircleCheckBig, "Scope terarah", "Satu divisi, maksimal dua proyek atau kontrak."],
                [ShieldCheck, "Workflow terkendali", "Satu alur cash advance dan approval chain."],
                [Headphones, "Onboarding didampingi", "Migrasi dasar, dua sesi training, dan weekly review."],
                [Sparkles, "Success criteria", "Adopsi, approval, settlement, dan profitabilitas terukur."],
              ].map(([Icon, title, body]) => {
                const PilotIcon = Icon as typeof CircleCheckBig;
                return (
                  <div key={String(title)} className="rounded-2xl border border-border/70 bg-background p-5">
                    <PilotIcon className="size-5 text-primary" />
                    <h3 className="mt-3 font-display font-semibold">{String(title)}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{String(body)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">FAQ</p>
            <h2 className="mt-3 font-display text-3xl font-semibold">Pertanyaan tentang harga</h2>
          </div>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border/70 bg-card px-6">
            {faqs.map(([question, answer]) => (
              <div key={question} className="py-6">
                <h3 className="font-display font-semibold">{question}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-3xl bg-foreground px-7 py-12 text-center text-background sm:px-12">
            <h2 className="font-display text-3xl font-semibold">Siap merapikan operasi proyek Anda?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-background/70">
              Buat workspace untuk eksplorasi awal atau ajukan pilot dengan scope yang disesuaikan.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button nativeButton={false} render={<Link href="/register-org" />}>
                Buat workspace
                <ArrowRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                className="border-background/25 bg-transparent text-background hover:bg-background/10 hover:text-background"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                Masuk ke akun
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 px-6 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ControlDesk · Project Operations &amp; Field Spend Control Platform
      </footer>
    </div>
  );
}
