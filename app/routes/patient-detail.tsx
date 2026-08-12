/**
 * The patient folder (T2.2).
 *
 * Everything `GET /patients/{id}` knows, laid out the way the paper folder is
 * read: who they are, then the alerts a clinician must see before writing
 * anything, then the detail.
 *
 * The allergy and chronic-condition banner sits above the fold on purpose —
 * it is the reason this screen loads before a prescription is written, and
 * Phase 7's dispensing check (T7.2) reads the same two lists.
 *
 * Three states get their own notice because they change what the folder
 * *means*: a merged folder is no longer the patient's record, a deceased
 * patient must not be queued, and an estimated age is not a date of birth.
 */

import { useEffect } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  ActivityIcon,
  GitMergeIcon,
  PencilIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { avatarTint, initialsOf, StatusPill } from "~/components/directory";
import { PageHeader } from "~/components/page-header";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getPatient } from "~/lib/api/patients";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import {
  BloodGroups,
  DobAccuracies,
  MaritalStatuses,
  MembershipStatuses,
  MobileNetworks,
  NhisExemptionCategories,
  Sexes,
} from "~/models/enums";
import { describeAllergy, type Patient, type PayerProfile } from "~/models/patient";
import { parseObjectId } from "~/models/primitives";
import type { Route } from "./+types/patient-detail";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.patient.fullName} · Clinic` : "Patient · Clinic" }];
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

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{children}</dl>
      </CardContent>
    </Card>
  );
}

/** One labelled fact. Absent values are shown as an em dash, never hidden —
 *  a blank next-of-kin field is information at a triage desk. */
function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function PayerCard({ profile }: { profile: PayerProfile }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{profile.label}</span>
        {profile.isPrimary && <StatusPill tone="muted">Primary</StatusPill>}
        {profile.payerType !== "cash" &&
          (profile.valid ? (
            <StatusPill tone="positive">Cover valid</StatusPill>
          ) : (
            <StatusPill tone="warning">Cover lapsed</StatusPill>
          ))}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Detail label="Member number" value={profile.memberNumber} />
        <Detail label="Membership" value={MembershipStatuses.labelOr(profile.status)} />
        <Detail
          label="Exemption"
          value={
            profile.exemptionCategory && profile.exemptionCategory !== "none"
              ? NhisExemptionCategories.label(profile.exemptionCategory)
              : undefined
          }
        />
        <Detail
          label="Expires"
          value={profile.expiresAt ? format(new Date(profile.expiresAt), "d MMM yyyy") : undefined}
        />
      </dl>
    </div>
  );
}

/**
 * The banner. Allergies are the destructive case — a missed one harms someone
 * — while chronic conditions are context, so they share the block but not the
 * emphasis.
 */
function ClinicalAlerts({ patient }: { patient: Patient }) {
  const { allergies, chronicConditions } = patient;
  if (allergies.length === 0 && chronicConditions.length === 0) return null;

  return (
    <div
      role="note"
      className={cn(
        "grid gap-4 rounded-xl border p-4 sm:grid-cols-2",
        allergies.length > 0 ? "border-destructive/40 bg-destructive/5" : "bg-muted/40",
      )}
    >
      <div className="space-y-1.5">
        <h2
          className={cn(
            "flex items-center gap-2 font-heading text-sm font-semibold",
            allergies.length > 0 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <TriangleAlertIcon className="size-4" />
          {allergies.length > 0 ? "Allergies" : "No known allergies"}
        </h2>
        {allergies.length > 0 && (
          <ul className="space-y-1 text-sm">
            {allergies.map((allergy) => (
              <li key={allergy.substance} className="font-medium">
                {describeAllergy(allergy)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <h2 className="flex items-center gap-2 font-heading text-sm font-semibold text-muted-foreground">
          <ActivityIcon className="size-4" />
          {chronicConditions.length > 0 ? "Chronic conditions" : "No chronic conditions"}
        </h2>
        {chronicConditions.length > 0 && (
          <ul className="space-y-1 text-sm">
            {chronicConditions.map((condition) => (
              <li key={condition.condition}>
                <span className="font-medium">{condition.condition}</span>
                {condition.icd10Code && (
                  <span className="text-muted-foreground"> · {condition.icd10Code}</span>
                )}
                {condition.diagnosedAt && (
                  <span className="text-muted-foreground">
                    {" "}
                    · since {format(new Date(condition.diagnosedAt), "MMM yyyy")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   The screen
   ------------------------------------------------------------------------- */

/** Confirmations handed over by the pages that redirect here. */
const NOTICES: Record<string, string> = {
  registered: "Folder created.",
  saved: "Folder updated.",
  merged: "Folders merged. This is the surviving record.",
};

export default function PatientFolderPage({ loaderData }: Route.ComponentProps) {
  const { patient } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();

  const noticeKey = Object.keys(NOTICES).find((key) => searchParams.has(key));

  useEffect(() => {
    if (!noticeKey) return;
    toast.success(NOTICES[noticeKey]);

    // The confirmation belongs to the navigation that carried it, not to the
    // URL — a reload or a shared link should not re-announce it.
    const params = new URLSearchParams(searchParams);
    for (const key of Object.keys(NOTICES)) params.delete(key);
    setSearchParams(params, { replace: true, preventScrollReset: true });
    // Keyed on the notice alone: adding `searchParams` would re-run this on
    // the very rewrite it performs.
  }, [noticeKey]);

  const ageIsEstimate = patient.age.accuracy !== "exact";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={patient.fullName}
        description={
          <>
            <span className="font-mono">{patient.folderNumber}</span> · {patient.age.display} ·{" "}
            {Sexes.label(patient.sex)}
          </>
        }
        backTo="/patients"
        backLabel="Back to patients"
      >
        <Link
          to={`/patients/${patient.id}/merge`}
          className={buttonVariants({ variant: "outline" })}
        >
          <GitMergeIcon />
          Merge duplicate
        </Link>
        <Link to={`/patients/${patient.id}/edit`} className={buttonVariants()}>
          <PencilIcon />
          Edit details
        </Link>
      </PageHeader>

      {patient.mergedInto && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
        >
          <p className="font-medium">This folder has been merged away.</p>
          <p className="mt-0.5 text-muted-foreground">
            Its visits, bills and results now live on{" "}
            <Link
              to={`/patients/${patient.mergedInto}`}
              className="font-medium text-primary hover:underline"
            >
              the surviving folder
            </Link>
            . Do not use this one for new visits.
          </p>
        </div>
      )}

      {patient.isDeceased && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm font-medium text-destructive"
        >
          This patient is recorded as deceased.
        </div>
      )}

      <ClinicalAlerts patient={patient} />

      {/* Identity */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Avatar className="size-14">
            <AvatarFallback
              className={cn("text-lg font-semibold uppercase", avatarTint(patient.id))}
            >
              {initialsOf(patient.firstName, patient.surname)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="font-heading text-lg font-semibold tracking-tight">
              {patient.fullName}
            </div>
            <div className="text-sm text-muted-foreground">
              Registered {format(new Date(patient.registeredAt), "d MMM yyyy")}
              {patient.lastVisitAt ? (
                <span suppressHydrationWarning>
                  {" · last seen "}
                  {formatDistanceToNow(new Date(patient.lastVisitAt), { addSuffix: true })}
                </span>
              ) : (
                " · no visits yet"
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            <Detail label="Age" value={patient.age.display} />
            <Detail label="Sex" value={Sexes.label(patient.sex)} />
            <Detail
              label="Blood group"
              value={
                patient.bloodGroup && patient.bloodGroup !== "unknown"
                  ? BloodGroups.labelOr(patient.bloodGroup)
                  : undefined
              }
            />
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailCard title="Demographics">
          <Detail label="Surname" value={patient.surname} />
          <Detail label="First name" value={patient.firstName} />
          <Detail label="Other names" value={patient.otherNames} className="sm:col-span-2" />
          <Detail
            label="Date of birth"
            value={
              patient.dateOfBirth ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  {format(new Date(patient.dateOfBirth), "d MMM yyyy")}
                  {ageIsEstimate && (
                    <span className="text-xs text-muted-foreground">
                      ({DobAccuracies.label(patient.age.accuracy).toLowerCase()})
                    </span>
                  )}
                </span>
              ) : ageIsEstimate ? (
                <span className="text-muted-foreground">
                  Not known — {DobAccuracies.label(patient.age.accuracy).toLowerCase()}
                </span>
              ) : undefined
            }
          />
          <Detail
            label="Marital status"
            value={
              patient.maritalStatus && patient.maritalStatus !== "unknown"
                ? MaritalStatuses.labelOr(patient.maritalStatus)
                : undefined
            }
          />
          <Detail label="Occupation" value={patient.occupation} />
          <Detail label="Religion" value={patient.religion} />
          <Detail label="Nationality" value={patient.nationality} className="sm:col-span-2" />
        </DetailCard>

        <DetailCard title="Contact and address">
          <Detail
            label="Phone"
            value={
              patient.phone ? (
                <a href={`tel:${patient.phone}`} className="text-primary hover:underline">
                  {patient.phoneFormatted ?? patient.phone}
                </a>
              ) : undefined
            }
          />
          <Detail
            label="Network"
            value={
              patient.mobileNetwork !== "unknown"
                ? MobileNetworks.label(patient.mobileNetwork)
                : undefined
            }
          />
          <Detail label="Alternative phone" value={patient.altPhone} />
          <Detail label="Email" value={patient.email} />
          <Detail
            label="Address"
            value={patient.residentialAddress}
            className="sm:col-span-2"
          />
          <Detail label="Town" value={patient.town} />
          <Detail label="GhanaPost GPS" value={patient.ghanaPostGps} />
          <Detail label="District" value={patient.district} />
          <Detail label="Region" value={patient.region} />
        </DetailCard>

        <DetailCard title="Identification">
          <Detail label="Folder number" value={<span className="font-mono">{patient.folderNumber}</span>} />
          <Detail label="Ghana Card" value={patient.ghanaCardNumber} />
          <Detail label="NHIS number" value={patient.nhisNumber} className="sm:col-span-2" />
        </DetailCard>

        <DetailCard title="Next of kin">
          <Detail label="Name" value={patient.nextOfKin?.name} />
          <Detail label="Relationship" value={patient.nextOfKin?.relationship} />
          <Detail
            label="Phone"
            value={
              patient.nextOfKin?.phone ? (
                <a href={`tel:${patient.nextOfKin.phone}`} className="text-primary hover:underline">
                  {patient.nextOfKin.phone}
                </a>
              ) : undefined
            }
          />
          <Detail label="Address" value={patient.nextOfKin?.address} />
        </DetailCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payer cover</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {patient.payerProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No payer recorded — this patient settles at the till.
            </p>
          ) : (
            patient.payerProfiles.map((profile, index) => (
              <PayerCard key={`${profile.payerType}-${profile.memberNumber ?? index}`} profile={profile} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
