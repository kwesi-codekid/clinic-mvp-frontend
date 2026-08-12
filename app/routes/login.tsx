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
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
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

      {/* The card. */}
      <div className="relative z-10 w-full max-w-100">
        <GlassOrb className="-left-12 -top-14 flex size-16">
          <HeartPulseIcon className="size-6 text-white/90" strokeWidth={1.5} />
        </GlassOrb>

        <div className="relative rounded-3xl border border-white/35 bg-white/15 px-8 py-9 shadow-[0_30px_70px_-24px_rgba(9,78,84,0.5)] backdrop-blur-xl sm:px-10">
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
                  {/* Positioning lives on the wrapper: the Button's own pressed
                      state applies a translate that would cancel a translate
                      placed directly on it and move it out from under the click. */}
                  <span className="absolute right-0 top-1/2 -translate-y-1/2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="rounded-full text-slate-400 hover:bg-transparent hover:text-slate-600 [&_svg:not([class*='size-'])]:size-4"
                    >
                      {showPassword ? <EyeIcon /> : <EyeOffIcon />}
                    </Button>
                  </span>
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
              className="h-10 w-full rounded-full bg-[#3bb0b9] text-xs font-medium tracking-[0.14em] text-white shadow-[0_14px_28px_-12px_rgba(9,78,84,0.65)] hover:bg-[#2fa5ae]"
            >
              {busy && <Loader2Icon className="animate-spin" />}
              SIGN IN
            </Button>
          </Form>
        </div>
      </div>
    </main>
  );
}
