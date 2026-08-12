/**
 * Edit a patient folder (T2.2) — the registration form again, on a page of its
 * own, prefilled from `GET /patients/{id}` and posting a sparse
 * `PATCH /patients/{id}`.
 *
 * The one thing that differs from registration is what a blank field means.
 * A patch reads an omitted key as "leave alone", so clearing a field has to be
 * said out loud with an empty string — `readPatientInput({ clearBlanks: true })`
 * is where that decision lives, along with the two fields the API's own
 * patterns refuse to accept an empty string for.
 *
 * There is no duplicate check here: this folder already exists, and the
 * records desk resolves a clash by merging, not by editing one folder to look
 * less like another.
 */

import { data, redirect, useNavigation } from "react-router";

import { PageHeader } from "~/components/page-header";
import { PatientForm } from "~/components/patient-form";
import { ApiError, describeApiError } from "~/lib/api/client";
import { getPatient, updatePatient } from "~/lib/api/patients";
import { throwRouteError } from "~/lib/api/route-error";
import { readPatientInput } from "~/lib/patient-form";
import { requireStaff, requireStaffAction } from "~/lib/auth.server";
import { parseObjectId } from "~/models/primitives";
import type { Route } from "./+types/patient-edit";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData ? `Edit ${loaderData.patient.fullName} · Clinic` : "Edit patient · Clinic" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { accessToken } = await requireStaff(request);
  const id = parseObjectId(params.patientId, "patient id");

  try {
    return { patient: await getPatient(id, { token: accessToken }) };
  } catch (error) {
    throwRouteError(error);
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { accessToken, setCookie } = await requireStaffAction(request);
  const id = parseObjectId(params.patientId, "patient id");

  const form = await request.formData();
  const headers = setCookie ? { "Set-Cookie": setCookie } : undefined;

  const input = readPatientInput(form, { clearBlanks: true });

  // Both are `minLength: 1` on the wire; an empty one is a rejected edit, not
  // an instruction to erase the name.
  if (!input.surname || !input.firstName) {
    const missing: Record<string, string> = {};
    if (!input.surname) missing["body.surname"] = "Enter a surname.";
    if (!input.firstName) missing["body.firstName"] = "Enter a first name.";
    return data(
      { message: "Fill in the fields marked below.", fieldErrors: missing },
      { status: 400, headers },
    );
  }

  try {
    await updatePatient(id, input, { token: accessToken });
    return redirect(`/patients/${id}?saved=1`, { headers });
  } catch (error) {
    if (!ApiError.is(error)) throw error;

    return data(
      { message: describeApiError(error).description, fieldErrors: error.fieldErrors() },
      { status: error.status >= 400 ? error.status : 502, headers },
    );
  }
}

export default function EditPatientPage({ loaderData, actionData }: Route.ComponentProps) {
  const { patient } = loaderData;
  const navigation = useNavigation();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`Edit ${patient.fullName}`}
        description={
          <>
            <span className="font-mono">{patient.folderNumber}</span> — changes take effect the
            moment you save.
          </>
        }
        backTo={`/patients/${patient.id}`}
        backLabel="Back to folder"
      />

      <PatientForm
        mode="edit"
        patient={patient}
        busy={navigation.formData != null}
        cancelTo={`/patients/${patient.id}`}
        error={actionData?.message}
        fieldErrors={actionData?.fieldErrors}
      />
    </div>
  );
}
