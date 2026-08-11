/**
 * Sign in — `POST /auth/login` behind the clinic's glassmorphism login screen.
 *
 * The visual is a faithful build of the approved design: teal atmosphere,
 * frosted glass card, underline inputs, pill buttons. All interactive pieces
 * are the shared shadcn primitives with the design's palette layered on via
 * `className` — no bespoke input or button components.
 *
 * The palette is deliberately hardcoded and theme-independent: this screen is
 * the design's teal world in light and dark mode alike. The app's own brand
 * tokens take over once the user is inside.
 */

import { useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  DnaIcon,
  EyeIcon,
  EyeOffIcon,
  HeartPulseIcon,
  Loader2Icon,
  StethoscopeIcon,
  UserRoundIcon,
} from "lucide-react";
import { data, Form, redirect, useNavigation } from "react-router";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { login } from "~/lib/api/auth";
import { ApiError, describeApiError } from "~/lib/api/client";
import { createStaffSession, hasSession } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/login";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Sign in · Clinic" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await hasSession(request)) {
    throw redirect("/");
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const identifier = String(form.get("identifier") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!identifier || !password) {
    return data(
      { error: "Enter your email or staff number and your password." },
      { status: 400 },
    );
  }

  try {
    const session = await login({ identifier, password });
    const redirectTo = new URL(request.url).searchParams.get("redirectTo");
    return await createStaffSession(session, redirectTo);
  } catch (error) {
    if (ApiError.is(error)) {
      const message = error.isAuthError
        ? "That email or staff number and password don't match. Try again."
        : describeApiError(error).description;
      return data(
        { error: message },
        { status: error.status >= 400 ? error.status : 502 },
      );
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------
   Design atoms — decoration only; every control is a shadcn component
   ------------------------------------------------------------------------- */

const ACCENT = "text-[#2aa2ab]";

/** The rounded medical cross above the heading. */
function CrossMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden {...props}>
      <defs>
        <linearGradient
          id="cross-teal"
          x1="20"
          y1="0"
          x2="20"
          y2="40"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#69d5da" />
          <stop offset="1" stopColor="#2ba7b1" />
        </linearGradient>
      </defs>
      <rect x="13" y="1" width="14" height="38" rx="5" fill="url(#cross-teal)" />
      <rect x="1" y="13" width="38" height="14" rx="5" fill="url(#cross-teal)" />
    </svg>
  );
}

/** A circular English flag for the language pill. */
function FlagEn(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden {...props}>
      <defs>
        <clipPath id="flag-en-clip">
          <circle cx="10" cy="10" r="10" />
        </clipPath>
      </defs>
      <g clipPath="url(#flag-en-clip)">
        <rect width="20" height="20" fill="#1d4586" />
        <path d="M0 0l20 20M20 0L0 20" stroke="#fff" strokeWidth="4" />
        <path d="M0 0l20 20M20 0L0 20" stroke="#d3212c" strokeWidth="1.6" />
        <path d="M10 0v20M0 10h20" stroke="#fff" strokeWidth="6" />
        <path d="M10 0v20M0 10h20" stroke="#d3212c" strokeWidth="3.4" />
      </g>
    </svg>
  );
}

/** The multicolour Google "G". */
function GoogleG(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden {...props}>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** A frosted glass bubble holding one of the floating medical icons. */
function GlassOrb({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute items-center justify-center rounded-full border border-white/30 bg-white/10 shadow-[inset_0_1px_14px_rgba(255,255,255,0.3),0_20px_45px_-20px_rgba(9,78,84,0.45)] backdrop-blur-[6px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The heartbeat trace running behind the card. */
function EcgLine() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-[56%] h-36 w-full text-white/70"
      viewBox="0 0 1440 160"
      preserveAspectRatio="none"
      fill="none"
    >
      <path
        d="M0 90h116l16-22 15 48 15-38 13 12h80m300 0h476m208 0h33l15-30 14 56 16-38 12 12h271"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function notAvailable(what: string, next: string) {
  toast.info(what, { description: next });
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function Login({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  const [showPassword, setShowPassword] = useState(false);

  const underlineInput =
    "h-9 rounded-none border-0 border-b border-[#2aa2ab]/35 bg-transparent px-0 text-[13px] text-slate-700 placeholder:text-slate-400 focus-visible:border-[#2aa2ab] focus-visible:shadow-[0_1px_0_0_#2aa2ab] focus-visible:ring-0 md:text-[13px] dark:bg-transparent";

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[radial-gradient(120%_90%_at_18%_0%,#5ecfd5_0%,#41bcc4_55%,#2ea8b2_100%)] px-4 py-16">
      {/* Atmosphere: dome, heartbeat, floating orbs. Decoration only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[54%] size-[150vmin] -translate-x-1/2 rounded-full border border-white/25 bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,0.2),rgba(255,255,255,0.05)_55%,rgba(255,255,255,0.02))]"
      />
      <EcgLine />
      <GlassOrb className="left-[6%] top-[34%] hidden size-28 sm:flex lg:left-[10%] lg:size-32">
        <DnaIcon className="size-11 text-white/90" strokeWidth={1.5} />
      </GlassOrb>
      <GlassOrb className="right-[5%] top-[44%] hidden size-32 sm:flex lg:right-[9%] lg:size-36">
        <StethoscopeIcon className="size-12 text-white/90" strokeWidth={1.5} />
      </GlassOrb>

      {/* Language selector. */}
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 items-center gap-1.5 rounded-full bg-[#0c5a63]/85 pl-1.5 pr-2.5 text-xs font-medium text-white shadow-sm outline-none transition-colors hover:bg-[#0c5a63] focus-visible:ring-2 focus-visible:ring-white/60">
          <FlagEn className="size-5" />
          En
          <ChevronDownIcon className="size-3.5 opacity-80" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem>
              English
              <CheckIcon className="ml-auto size-4" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* The card. */}
      <div className="relative z-10 w-full max-w-[400px]">
        <GlassOrb className="-left-12 -top-14 flex size-16">
          <HeartPulseIcon className="size-6 text-white/90" strokeWidth={1.5} />
        </GlassOrb>

        <div className="relative rounded-3xl border border-white/60 bg-white/55 px-8 py-9 shadow-[0_30px_70px_-24px_rgba(9,78,84,0.5)] backdrop-blur-xl sm:px-10">
          <CrossMark className="mx-auto block size-10" />
          <h1 className="mt-4 text-center font-heading text-[25px] font-semibold tracking-tight text-slate-700">
            Welcome Back!
          </h1>

          <Form method="post" className="mt-8 space-y-5" replace>
            <FieldGroup className="gap-6">
              <Field className="gap-1.5">
                <FieldLabel
                  htmlFor="identifier"
                  className={cn("text-[11px] font-medium tracking-wide", ACCENT)}
                >
                  Email or No. Handphone
                </FieldLabel>
                <div className="relative">
                  <Input
                    id="identifier"
                    name="identifier"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    placeholder="wanda@gmail.com/08..."
                    className={cn(underlineInput, "pr-8")}
                  />
                  <UserRoundIcon className="pointer-events-none absolute right-1 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                </div>
              </Field>

              <Field className="gap-1.5">
                <FieldLabel htmlFor="password" className="sr-only">
                  Password
                </FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="Password"
                    className={cn(underlineInput, "pr-8")}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full text-slate-400 hover:bg-transparent hover:text-slate-600 [&_svg:not([class*='size-'])]:size-4"
                  >
                    {showPassword ? <EyeIcon /> : <EyeOffIcon />}
                  </Button>
                </div>
              </Field>
            </FieldGroup>

            <div className="-mt-2 flex justify-end">
              <Button
                type="button"
                variant="link"
                onClick={() =>
                  notAvailable(
                    "Password resets are handled by the administrator",
                    "Ask them to set you a new password.",
                  )
                }
                className={cn("h-auto p-0 text-[11px] font-normal", ACCENT)}
              >
                Forget Password ?
              </Button>
            </div>

            {actionData?.error && (
              <div
                role="alert"
                className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700"
              >
                {actionData.error}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="h-10 w-full rounded-full bg-[#3bb0b9] text-xs font-bold tracking-[0.14em] text-white shadow-[0_14px_28px_-12px_rgba(9,78,84,0.65)] hover:bg-[#2fa5ae]"
            >
              {busy && <Loader2Icon className="animate-spin" />}
              SIGN IN
            </Button>

            <div className="flex items-center gap-3">
              <Separator className="flex-1 bg-slate-400/40" />
              <span className="text-[11px] font-medium text-slate-500">OR</span>
              <Separator className="flex-1 bg-slate-400/40" />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                notAvailable(
                  "Google sign-in isn't available",
                  "Sign in with your clinic email or staff number.",
                )
              }
              className="h-10 w-full rounded-full border-transparent bg-white text-xs font-medium text-slate-600 shadow-[0_12px_24px_-14px_rgba(9,78,84,0.6)] hover:bg-white hover:text-slate-700 dark:border-transparent dark:bg-white dark:hover:bg-white"
            >
              <GoogleG className="size-4" />
              Continue with Google
            </Button>
          </Form>

          <p className="mt-7 text-center text-[11px] text-slate-500">
            Dont have an account ?{" "}
            <Button
              type="button"
              variant="link"
              onClick={() =>
                notAvailable(
                  "Accounts are created by the administrator",
                  "Ask them to add you as staff.",
                )
              }
              className={cn("h-auto p-0 align-baseline text-[11px] font-semibold", ACCENT)}
            >
              Sign Up
            </Button>
          </p>
        </div>
      </div>
    </main>
  );
}
