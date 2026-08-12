/**
 * The patient form — one component behind both the registration page and the
 * edit page, because a folder is a folder whichever door you came in through.
 *
 * It is a plain `<Form method="post">` of native controls: the action reads
 * the whole submission off `FormData` (see `~/lib/patient-form`), so there is
 * no client-side form state to keep in step with the server. The only state
 * here is structural — how many payer, allergy and condition rows exist, and
 * which age question is being answered — and none of it changes what a field
 * is called on the wire.
 *
 * Field errors arrive keyed the way the API writes them (`body.surname`,
 * `body.payerProfiles.0.payerType`) and are hung off the input that caused
 * them.
 */

import { useRef, useState, type ReactNode } from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { Form, Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import {
  BloodGroups,
  DobAccuracies,
  MaritalStatuses,
  MembershipStatuses,
  NhisExemptionCategories,
  PayerTypes,
  Sexes,
  type DobAccuracy,
} from "~/models/enums";
import type {
  Allergy,
  ChronicCondition,
  Patient,
  PayerProfile,
} from "~/models/patient";

/* -------------------------------------------------------------------------
   Small field wrappers
   ------------------------------------------------------------------------- */

function TextField({
  name,
  label,
  error,
  hint,
  className,
  id: suffix,
  ...input
}: React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  /** Distinguishes repeated rows, which share a field name. */
  id?: string;
}) {
  const id = suffix === undefined ? `patient-${name}` : `patient-${name}-${suffix}`;
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={name} aria-invalid={error ? true : undefined} {...input} />
      {hint && !error && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function SelectField({
  name,
  label,
  items,
  defaultValue,
  error,
  hint,
  className,
  id: suffix,
  onValueChange,
}: {
  name: string;
  label: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  defaultValue: string;
  error?: string;
  hint?: string;
  className?: string;
  /** Distinguishes repeated rows, which share a field name. */
  id?: string;
  onValueChange?: (value: string) => void;
}) {
  const id = suffix === undefined ? `patient-${name}` : `patient-${name}-${suffix}`;
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {/* `items` is what makes the trigger show the label rather than the wire
          value; the hidden input `name` posts the value itself. */}
      <Select
        id={id}
        name={name}
        defaultValue={defaultValue}
        items={items}
        onValueChange={(value) => onValueChange?.(String(value))}
      >
        <SelectTrigger className="h-8 w-full" aria-invalid={error ? true : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && !error && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
   Repeating rows
   ------------------------------------------------------------------------- */

/**
 * A list of rows the clerk can grow and shrink.
 *
 * Rows are keyed rather than indexed so removing the middle one does not make
 * React reuse its inputs for its neighbour. Position still decides everything
 * on the wire — the reader zips the parallel lists by index — so the rendered
 * order is the submitted order.
 */
function useRows<T>(initial: readonly T[]) {
  const nextKey = useRef(initial.length);
  const [rows, setRows] = useState(() =>
    initial.map((value, index) => ({ key: index, value: value as T | undefined })),
  );

  return {
    rows,
    add: () => setRows((current) => [...current, { key: nextKey.current++, value: undefined }]),
    remove: (key: number) => setRows((current) => current.filter((row) => row.key !== key)),
  };
}

function RowFrame({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove ${label.toLowerCase()}`}
        >
          <Trash2Icon />
        </Button>
      </div>
      {children}
    </div>
  );
}

function AddRowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <PlusIcon />
      {children}
    </Button>
  );
}

function EmptyRows({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------
   Sections that repeat
   ------------------------------------------------------------------------- */

const PAYER_ITEMS = PayerTypes.options();
const EXEMPTION_ITEMS = NhisExemptionCategories.options();
const STATUS_ITEMS = MembershipStatuses.options();

function PayerRows({
  profiles,
  fieldError,
}: {
  profiles: readonly PayerProfile[];
  fieldError: (path: string) => string | undefined;
}) {
  const { rows, add, remove } = useRows(profiles);
  const primaryIndex = Math.max(
    profiles.findIndex((profile) => profile.isPrimary),
    0,
  );

  return (
    <>
      {rows.length === 0 ? (
        <EmptyRows>
          No payer recorded — the patient will be billed as a cash payer.
        </EmptyRows>
      ) : (
        <RadioGroup name="payerPrimary" defaultValue={String(primaryIndex)} className="gap-3">
          {rows.map((row, index) => {
            const payer = row.value;
            const at = (field: string) => fieldError(`payerProfiles.${index}.${field}`);

            return (
              <RowFrame key={row.key} label={`Payer ${index + 1}`} onRemove={() => remove(row.key)}>
                {/* Carried through untouched: the scheme is chosen in facility
                    admin (T14.2), and re-posting the list must not drop it. */}
                <input type="hidden" name="payerSchemeId" value={payer?.schemeId ?? ""} />

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <SelectField
                    id={String(row.key)}
                    name="payerType"
                    label="Payer"
                    items={PAYER_ITEMS}
                    defaultValue={payer?.payerType ?? "cash"}
                    error={at("payerType")}
                  />
                  <TextField
                    id={String(row.key)}
                    name="payerMemberNumber"
                    label="Member number"
                    defaultValue={payer?.memberNumber}
                    placeholder="NHIS or scheme number"
                    error={at("memberNumber")}
                  />
                  <SelectField
                    id={String(row.key)}
                    name="payerExemption"
                    label="NHIS exemption"
                    items={EXEMPTION_ITEMS}
                    defaultValue={payer?.exemptionCategory ?? "none"}
                    error={at("exemptionCategory")}
                  />
                  <SelectField
                    id={String(row.key)}
                    name="payerStatus"
                    label="Membership"
                    items={STATUS_ITEMS}
                    defaultValue={payer?.status ?? "unverified"}
                    error={at("status")}
                  />
                  <TextField
                    id={String(row.key)}
                    name="payerExpiresOn"
                    label="Cover expires"
                    type="date"
                    defaultValue={payer?.expiresAt?.slice(0, 10)}
                    error={at("expiresAt")}
                  />
                  <FieldLabel className="items-center gap-2 self-end rounded-lg border p-2 font-normal sm:col-span-2 lg:col-span-3">
                    <RadioGroupItem value={String(index)} />
                    Bill this one first
                  </FieldLabel>
                </div>
              </RowFrame>
            );
          })}
        </RadioGroup>
      )}

      <div className="flex items-center justify-between gap-3">
        <AddRowButton onClick={add}>Add payer</AddRowButton>
        <FieldError>{fieldError("payerProfiles")}</FieldError>
      </div>
    </>
  );
}

function AllergyRows({
  allergies,
  fieldError,
}: {
  allergies: readonly Allergy[];
  fieldError: (path: string) => string | undefined;
}) {
  const { rows, add, remove } = useRows(allergies);

  return (
    <>
      {rows.length === 0 ? (
        <EmptyRows>No known allergies recorded.</EmptyRows>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <RowFrame key={row.key} label={`Allergy ${index + 1}`} onRemove={() => remove(row.key)}>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  id={String(row.key)}
                  name="allergySubstance"
                  label="Substance"
                  placeholder="Penicillin"
                  defaultValue={row.value?.substance}
                  error={fieldError(`allergies.${index}.substance`)}
                />
                <TextField
                  id={String(row.key)}
                  name="allergyReaction"
                  label="Reaction"
                  placeholder="Rash, swelling"
                  defaultValue={row.value?.reaction}
                  error={fieldError(`allergies.${index}.reaction`)}
                />
                <TextField
                  id={String(row.key)}
                  name="allergySeverity"
                  label="Severity"
                  placeholder="Severe"
                  defaultValue={row.value?.severity}
                  error={fieldError(`allergies.${index}.severity`)}
                />
              </div>
            </RowFrame>
          ))}
        </div>
      )}
      <AddRowButton onClick={add}>Add allergy</AddRowButton>
    </>
  );
}

function ConditionRows({
  conditions,
  fieldError,
}: {
  conditions: readonly ChronicCondition[];
  fieldError: (path: string) => string | undefined;
}) {
  const { rows, add, remove } = useRows(conditions);

  return (
    <>
      {rows.length === 0 ? (
        <EmptyRows>No chronic conditions recorded.</EmptyRows>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <RowFrame
              key={row.key}
              label={`Condition ${index + 1}`}
              onRemove={() => remove(row.key)}
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  id={String(row.key)}
                  name="conditionName"
                  label="Condition"
                  placeholder="Type 2 diabetes"
                  defaultValue={row.value?.condition}
                  error={fieldError(`chronicConditions.${index}.condition`)}
                />
                <TextField
                  id={String(row.key)}
                  name="conditionIcd10"
                  label="ICD-10 code"
                  placeholder="E11"
                  defaultValue={row.value?.icd10Code}
                  error={fieldError(`chronicConditions.${index}.icd10Code`)}
                />
                <TextField
                  id={String(row.key)}
                  name="conditionDiagnosedOn"
                  label="Diagnosed"
                  type="date"
                  defaultValue={row.value?.diagnosedAt?.slice(0, 10)}
                  error={fieldError(`chronicConditions.${index}.diagnosedAt`)}
                />
              </div>
            </RowFrame>
          ))}
        </div>
      )}
      <AddRowButton onClick={add}>Add condition</AddRowButton>
    </>
  );
}

/* -------------------------------------------------------------------------
   Age
   ------------------------------------------------------------------------- */

const ACCURACY_ITEMS = DobAccuracies.options();

/**
 * The age block. Which input appears is the clerk's answer to "how well is
 * this known?" — an estimate is a normal answer here, not a failure to fill
 * the form in, and recording it as one keeps `PatientAge.accuracy` honest all
 * the way through to the folder.
 */
function AgeFields({
  patient,
  fieldError,
}: {
  patient?: Patient;
  fieldError: (path: string) => string | undefined;
}) {
  const [accuracy, setAccuracy] = useState<DobAccuracy>(patient?.age.accuracy ?? "exact");

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        name="dobAccuracy"
        label="Date of birth is"
        items={ACCURACY_ITEMS}
        defaultValue={accuracy}
        onValueChange={(value) => setAccuracy(value as DobAccuracy)}
        error={fieldError("dobAccuracy")}
      />

      {accuracy === "exact" && (
        <TextField
          name="dateOfBirth"
          label="Date of birth"
          type="date"
          defaultValue={patient?.dateOfBirth}
          error={fieldError("dateOfBirth")}
        />
      )}

      {accuracy === "year_only" && (
        <TextField
          name="birthYear"
          label="Year of birth"
          type="number"
          inputMode="numeric"
          min={1900}
          max={new Date().getFullYear()}
          placeholder="1985"
          defaultValue={patient?.dateOfBirth?.slice(0, 4)}
          hint="Recorded as 1 January of that year."
          error={fieldError("dateOfBirth")}
        />
      )}

      {accuracy === "estimated_age" && (
        <TextField
          name="estimatedAgeYears"
          label="Estimated age"
          type="number"
          inputMode="numeric"
          min={0}
          max={130}
          placeholder="45"
          defaultValue={patient?.age.years}
          hint="In whole years, as judged at the desk."
          error={fieldError("estimatedAgeYears")}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   The form
   ------------------------------------------------------------------------- */

export type PatientFormProps = {
  mode: "create" | "edit";
  /** Prefills every field. Absent on registration. */
  patient?: Patient;
  /** `body.surname` → message, straight from the API's `details[]`. */
  fieldErrors?: Record<string, string>;
  /** Banner copy for a failed submission. */
  error?: string;
  /** A submission is in flight — disable the confirm and show the spinner. */
  busy: boolean;
  /** Where Cancel goes back to. */
  cancelTo: string;
  /** Rendered inside the form, above the fields — the duplicate panels. */
  children?: ReactNode;
  /** The live duplicate check hooks in here; see the registration route. */
  formRef?: React.Ref<HTMLFormElement>;
  onFormChange?: React.FormEventHandler<HTMLFormElement>;
};

export function PatientForm({
  mode,
  patient,
  fieldErrors = {},
  error,
  busy,
  cancelTo,
  children,
  formRef,
  onFormChange,
}: PatientFormProps) {
  // Paths arrive as the API writes them: `body.<field>`.
  const fieldError = (path: string) => fieldErrors[`body.${path}`];

  return (
    <Form
      method="post"
      ref={formRef}
      onChange={onFormChange}
      className="space-y-4 pb-4"
    >
      <input type="hidden" name="intent" value={mode === "edit" ? "save" : "register"} />

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {children}

      <Section
        title="Identity"
        description="The name on the folder, and how sure we are of the age."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="surname"
            label="Surname"
            required
            autoComplete="off"
            defaultValue={patient?.surname}
            error={fieldError("surname")}
          />
          <TextField
            name="firstName"
            label="First name"
            required
            autoComplete="off"
            defaultValue={patient?.firstName}
            error={fieldError("firstName")}
          />
          <TextField
            name="otherNames"
            label="Other names"
            className="sm:col-span-2"
            defaultValue={patient?.otherNames}
            error={fieldError("otherNames")}
          />
        </div>

        <Field>
          <FieldLabel>Sex</FieldLabel>
          <RadioGroup
            name="sex"
            defaultValue={patient?.sex}
            className="grid-cols-2 gap-2 sm:max-w-xs"
          >
            {Sexes.options().map((option) => (
              <FieldLabel
                key={option.value}
                className="w-full items-center gap-2 rounded-lg border p-2 font-normal"
              >
                <RadioGroupItem value={option.value} />
                {option.label}
              </FieldLabel>
            ))}
          </RadioGroup>
          <FieldDescription>
            Recorded for clinical use — it decides lab reference ranges.
          </FieldDescription>
          <FieldError>{fieldError("sex")}</FieldError>
        </Field>

        <AgeFields patient={patient} fieldError={fieldError} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            name="maritalStatus"
            label="Marital status"
            items={MaritalStatuses.options()}
            defaultValue={
              MaritalStatuses.is(patient?.maritalStatus) ? patient.maritalStatus : "unknown"
            }
            error={fieldError("maritalStatus")}
          />
          <TextField
            name="occupation"
            label="Occupation"
            placeholder="Trader"
            defaultValue={patient?.occupation}
            error={fieldError("occupation")}
          />
          <TextField
            name="religion"
            label="Religion"
            defaultValue={patient?.religion}
            error={fieldError("religion")}
          />
          <TextField
            name="nationality"
            label="Nationality"
            defaultValue={patient?.nationality ?? "Ghanaian"}
            error={fieldError("nationality")}
          />
        </div>
      </Section>

      <Section
        title="Contact and address"
        description="Where to reach them, and where they live."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            name="phone"
            label="Phone"
            type="tel"
            placeholder="024 000 0000"
            defaultValue={patient?.phone}
            hint="Any local format — the API normalises it."
            error={fieldError("phone")}
          />
          <TextField
            name="altPhone"
            label="Alternative phone"
            type="tel"
            defaultValue={patient?.altPhone}
            error={fieldError("altPhone")}
          />
          <TextField
            name="email"
            label="Email"
            type="email"
            autoComplete="off"
            defaultValue={patient?.email}
            error={fieldError("email")}
          />
          <TextField
            name="town"
            label="Town"
            defaultValue={patient?.town}
            error={fieldError("town")}
          />
          <TextField
            name="district"
            label="District"
            defaultValue={patient?.district}
            error={fieldError("district")}
          />
          <TextField
            name="region"
            label="Region"
            defaultValue={patient?.region}
            error={fieldError("region")}
          />
          <TextField
            name="ghanaPostGps"
            label="GhanaPost GPS"
            placeholder="GA-123-4567"
            defaultValue={patient?.ghanaPostGps}
            error={fieldError("ghanaPostGps")}
          />
        </div>

        <Field>
          <FieldLabel htmlFor="patient-residentialAddress">Residential address</FieldLabel>
          <Textarea
            id="patient-residentialAddress"
            name="residentialAddress"
            rows={2}
            placeholder="House number, street, landmark"
            defaultValue={patient?.residentialAddress}
            aria-invalid={fieldError("residentialAddress") ? true : undefined}
          />
          <FieldError>{fieldError("residentialAddress")}</FieldError>
        </Field>
      </Section>

      <Section
        title="Identification"
        description="What ties this folder to the person — and to any existing one."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="ghanaCardNumber"
            label="Ghana Card number"
            placeholder="GHA-123456789-0"
            defaultValue={patient?.ghanaCardNumber}
            error={fieldError("ghanaCardNumber")}
          />
          <TextField
            name="nhisNumber"
            label="NHIS number"
            defaultValue={patient?.nhisNumber}
            error={fieldError("nhisNumber")}
          />
        </div>
      </Section>

      <Section
        title="Payer cover"
        description="How the bill gets settled. The one marked first is what the till proposes."
      >
        <PayerRows profiles={patient?.payerProfiles ?? []} fieldError={fieldError} />
      </Section>

      <Section
        title="Clinical alerts"
        description="What a prescriber must see before writing anything."
      >
        <div className="grid gap-4 sm:max-w-xs">
          <SelectField
            name="bloodGroup"
            label="Blood group"
            items={BloodGroups.options()}
            defaultValue={BloodGroups.is(patient?.bloodGroup) ? patient.bloodGroup : "unknown"}
            error={fieldError("bloodGroup")}
          />
        </div>
        <AllergyRows allergies={patient?.allergies ?? []} fieldError={fieldError} />
        <ConditionRows conditions={patient?.chronicConditions ?? []} fieldError={fieldError} />
      </Section>

      <Section title="Next of kin" description="Who to call if this patient cannot answer.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="kinName"
            label="Name"
            defaultValue={patient?.nextOfKin?.name}
            error={fieldError("nextOfKin.name")}
          />
          <TextField
            name="kinRelationship"
            label="Relationship"
            placeholder="Sister"
            defaultValue={patient?.nextOfKin?.relationship}
            error={fieldError("nextOfKin.relationship")}
          />
          <TextField
            name="kinPhone"
            label="Phone"
            type="tel"
            defaultValue={patient?.nextOfKin?.phone}
            error={fieldError("nextOfKin.phone")}
          />
          <TextField
            name="kinAddress"
            label="Address"
            defaultValue={patient?.nextOfKin?.address}
            error={fieldError("nextOfKin.address")}
          />
        </div>
      </Section>

      {/* Long form, short patience: the actions stay reachable from anywhere
          in it rather than only at the very bottom. */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Link to={cancelTo} className="text-sm text-muted-foreground hover:underline">
          Cancel
        </Link>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" />}
          {mode === "edit" ? "Save changes" : "Register patient"}
        </Button>
      </div>
    </Form>
  );
}
