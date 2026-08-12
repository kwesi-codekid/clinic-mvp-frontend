/**
 * Register a patient — a page of its own, not a drawer (T2.2, T2.3).
 *
 * A folder is six sections of form; it deserves the whole screen, a URL a
 * clerk can be sent, and a browser back button that means something. The edit
 * screen is the same form on the same shape of page, for the same reason.
 *
 * **Search before register** runs twice over, deliberately:
 *
 * 1. *While typing.* A debounced fetcher posts the identity fields to
 *    `POST /patients/check-duplicates` — the endpoint the API documents as
 *    "call this while the clerk is still typing" — and shows what it finds
 *    without interrupting anyone. A failed check is swallowed: a background
 *    lookup must never be what stops a patient being registered.
 * 2. *At submit.* `POST /patients` refuses with a `409` and its own candidate
 *    list when it thinks this person already has a folder. That refusal is the
 *    authority — the typing-time check is only a courtesy — and clearing it
 *    takes an explicit "register anyway", which is the one control that sends
 *    `forceCreate`.
 */

import { useEffect, useRef } from "react";
import { Loader2Icon, SearchCheckIcon } from "lucide-react";
import { data, redirect, useFetcher, useNavigation } from "react-router";

import { CandidatePanel } from "~/components/duplicate-candidates";
import { PageHeader } from "~/components/page-header";
import { PatientForm } from "~/components/patient-form";
import { Button } from "~/components/ui/button";
import { ApiError, describeApiError } from "~/lib/api/client";
import {
  checkDuplicates,
  createPatient,
  duplicateCandidatesOf,
} from "~/lib/api/patients";
import {
  DUPLICATE_SEARCH_FIELDS,
  readDuplicateSearch,
  readPatientInput,
} from "~/lib/patient-form";
import { requireStaffAction } from "~/lib/auth.server";
import type { DuplicateCandidate } from "~/models/patient";
import type { Route } from "./+types/patient-new";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Register a patient · Clinic" }];
}

/* -------------------------------------------------------------------------
   Write
   ------------------------------------------------------------------------- */

export async function action({ request }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "register");

  const opts = { token: accessToken };
  // A rotated token has to ride out on every exit, success or not.
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  if (intent === "check") {
    try {
      const candidates = await checkDuplicates(readDuplicateSearch(form), opts);
      return data({ kind: "candidates" as const, candidates }, { headers });
    } catch {
      // Courtesy, not a gate. The 409 on submit is what actually protects the
      // records desk from duplicates.
      return data({ kind: "candidates" as const, candidates: [] }, { headers });
    }
  }

  const fail = (
    message: string,
    fieldErrors: Record<string, string> = {},
    candidates: DuplicateCandidate[] = [],
    status = 400,
  ) => data({ kind: "error" as const, message, fieldErrors, candidates }, { status, headers });

  const input = readPatientInput(form, { clearBlanks: false });
  const { surname, firstName, sex } = input;

  // The browser enforces these on the form; a hand-rolled POST does not.
  if (!surname || !firstName || !sex) {
    const missing: Record<string, string> = {};
    if (!surname) missing["body.surname"] = "Enter a surname.";
    if (!firstName) missing["body.firstName"] = "Enter a first name.";
    if (!sex) missing["body.sex"] = "Choose male or female.";
    return fail("Fill in the fields marked below.", missing);
  }

  try {
    const patient = await createPatient(
      {
        ...input,
        surname,
        firstName,
        sex,
        // Only ever set by the override button, and only after the clerk has
        // seen the candidates it overrides.
        forceCreate: form.get("forceCreate") === "true" || undefined,
      },
      opts,
    );

    return redirect(`/patients/${patient.id}?registered=1`, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    const candidates = duplicateCandidatesOf(error);
    const message =
      candidates.length > 0
        ? "This patient may already have a folder."
        : describeApiError(error).description;

    return fail(
      message,
      error.fieldErrors(),
      candidates,
      error.status >= 400 ? error.status : 502,
    );
  }
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

export default function NewPatientPage({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  // Covers the POST and the redirect that follows it, so the button stays busy
  // until the folder page is actually on screen.
  const busy = navigation.formData != null;

  const failure = actionData?.kind === "error" ? actionData : undefined;

  /* The typing-time duplicate check. It posts a slice of the form the clerk is
     filling in, so there is no second set of fields to keep in step. */
  const check = useFetcher<typeof action>();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSearch = useRef("");

  useEffect(() => () => clearTimeout(timer.current), []);

  function scheduleDuplicateCheck() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const form = formRef.current;
      if (!form) return;

      const source = new FormData(form);
      const search = new FormData();
      for (const field of DUPLICATE_SEARCH_FIELDS) {
        const value = source.get(field);
        if (typeof value === "string" && value.trim()) search.set(field, value.trim());
      }

      // A surname alone matches half of Ghana; wait for a first name too.
      if (!search.get("surname") || !search.get("firstName")) return;

      const key = Array.from(search.entries())
        .map(([field, value]) => `${field}=${String(value)}`)
        .join("&");
      if (key === lastSearch.current) return;
      lastSearch.current = key;

      search.set("intent", "check");
      check.submit(search, { method: "post" });
    }, 500);
  }

  const checking = check.state !== "idle";
  const suggested =
    check.data?.kind === "candidates" ? check.data.candidates : ([] as DuplicateCandidate[]);
  // The refusal wins the slot: it is the one the clerk has to answer.
  const blocking = failure?.candidates ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Register a patient"
        description="Open a new folder. The clinic checks for an existing one as you type."
        backTo="/patients"
        backLabel="Back to patients"
      />

      <PatientForm
        mode="create"
        busy={busy}
        cancelTo="/patients"
        error={failure && blocking.length === 0 ? failure.message : undefined}
        fieldErrors={failure?.fieldErrors}
        formRef={formRef}
        onFormChange={scheduleDuplicateCheck}
      >
        {blocking.length > 0 && (
          <CandidatePanel
            tone="blocking"
            title="This patient may already have a folder"
            description="The clinic would not register this as a new patient. Open the folders below — if one of them is this person, use it instead of making a second one."
            candidates={blocking}
            footer={
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-destructive/20 pt-3">
                <p className="text-sm text-muted-foreground">
                  Certain this is somebody else?
                </p>
                <Button
                  type="submit"
                  name="forceCreate"
                  value="true"
                  variant="destructive"
                  disabled={busy}
                >
                  {busy && <Loader2Icon className="animate-spin" />}
                  Register a new folder anyway
                </Button>
              </div>
            }
          />
        )}

        {blocking.length === 0 && suggested.length > 0 && (
          <CandidatePanel
            tone="notice"
            title={`${suggested.length} existing ${suggested.length === 1 ? "folder looks" : "folders look"} similar`}
            description="Checked as you typed. Open one to compare before you carry on — registering a second folder for the same person splits their history."
            candidates={suggested}
          />
        )}

        {blocking.length === 0 && suggested.length === 0 && (checking || check.data) && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {checking ? (
              <>
                <Loader2Icon className="size-4 animate-spin" />
                Checking for an existing folder…
              </>
            ) : (
              <>
                <SearchCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                No existing folder matches this name.
              </>
            )}
          </p>
        )}
      </PatientForm>
    </div>
  );
}
