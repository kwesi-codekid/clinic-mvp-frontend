/**
 * The staff drawer — one right-hand panel for every write in the directory.
 *
 * Add, edit, deactivate and reactivate all open here rather than on their own
 * page or in a centred dialog: the table stays visible behind the panel, so an
 * admin keeps the row they were working on in sight while they change it.
 *
 * Every panel is a plain `<Form method="post">` posting back to the staff
 * route, and every control is a native one (or a Base UI control carrying a
 * `name`). There is no client-side form state to keep in sync — the action
 * reads the whole submission off `FormData`, and the panel works without JS.
 */

import { useRef, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { Form } from "react-router";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { LicenceCouncils, Roles, Stations } from "~/models/enums";
import type { Staff } from "~/models/staff";

/**
 * The `station` select's stand-in for "not tied to a station". A select cannot
 * post `null`, and an empty option value is indistinguishable from an untouched
 * field — the action maps this sentinel back to `station: null`.
 */
export const NO_STATION = "no-station";

/** Which panel is open, and for whom. `null` closes the drawer. */
export type StaffDrawerState =
  | { mode: "create" }
  | { mode: "edit"; staff: Staff }
  | { mode: "deactivate"; staff: Staff }
  | { mode: "activate"; staff: Staff };

type StaffDrawerProps = {
  state: StaffDrawerState | null;
  onClose: () => void;
  /** A submission is in flight — disable the confirm and show the spinner. */
  busy: boolean;
  /** `body.email` → message, straight from the API's `details[]`. */
  fieldErrors?: Record<string, string>;
  /** Banner copy for a failed submission. */
  error?: string;
};

const STATION_ITEMS = [
  { value: NO_STATION, label: "No station" },
  ...Stations.options(),
];

const COUNCIL_ITEMS = LicenceCouncils.options();

export function StaffDrawer({
  state,
  onClose,
  busy,
  fieldErrors = {},
  error,
}: StaffDrawerProps) {
  // Closing animates the panel out over ~200ms. Rendering the state we were
  // last opened with keeps content in it for the whole slide, instead of
  // blanking the moment the caller clears its state.
  const lastOpen = useRef<StaffDrawerState | null>(null);
  if (state) lastOpen.current = state;
  const view = state ?? lastOpen.current;

  return (
    <Sheet
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="gap-0 data-[side=right]:sm:max-w-xl">
        {view &&
          (view.mode === "create" || view.mode === "edit" ? (
            <StaffFormPanel
              state={view}
              busy={busy}
              fieldErrors={fieldErrors}
              error={error}
            />
          ) : (
            <ConfirmPanel state={view} busy={busy} error={error} />
          ))}
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------
   Panel pieces
   ------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </div>
  );
}

function TextField({
  name,
  label,
  error,
  hint,
  className,
  ...input
}: React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = `staff-${name}`;
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
}: {
  name: string;
  label: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  defaultValue: string;
  error?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={`staff-${name}`}>{label}</FieldLabel>
      {/* `items` is what makes the trigger show the label rather than the
          wire value; the hidden input `name` posts the value itself. */}
      <Select id={`staff-${name}`} name={name} defaultValue={defaultValue} items={items}>
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
      <FieldError>{error}</FieldError>
    </Field>
  );
}

/* -------------------------------------------------------------------------
   Add / edit
   ------------------------------------------------------------------------- */

function StaffFormPanel({
  state,
  busy,
  fieldErrors,
  error,
}: {
  state: { mode: "create" } | { mode: "edit"; staff: Staff };
  busy: boolean;
  fieldErrors: Record<string, string>;
  error?: string;
}) {
  const staff = state.mode === "edit" ? state.staff : undefined;
  // Paths arrive as the API writes them: `body.<field>`.
  const fieldError = (field: string) => fieldErrors[`body.${field}`];

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{staff ? staff.fullName : "Add staff"}</SheetTitle>
        <SheetDescription>
          {staff
            ? "Changes take effect the moment you save."
            : "Create the account and the sign-in details that go with it."}
        </SheetDescription>
      </SheetHeader>

      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="intent" value={staff ? "edit" : "create"} />
        {staff && <input type="hidden" name="id" value={staff.id} />}

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}

          <Section title="Identity">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="title"
                label="Title"
                placeholder="Dr"
                defaultValue={staff?.title}
                error={fieldError("title")}
              />
              <TextField
                name="staffNumber"
                label="Staff number"
                defaultValue={staff?.staffNumber}
                required={Boolean(staff)}
                hint={staff ? undefined : "Assigned by the API if left blank."}
                error={fieldError("staffNumber")}
              />
              <TextField
                name="firstName"
                label="First name"
                required
                defaultValue={staff?.firstName}
                error={fieldError("firstName")}
              />
              <TextField
                name="surname"
                label="Surname"
                required
                defaultValue={staff?.surname}
                error={fieldError("surname")}
              />
              <TextField
                name="otherNames"
                label="Other names"
                className="sm:col-span-2"
                defaultValue={staff?.otherNames}
                error={fieldError("otherNames")}
              />
            </div>
          </Section>

          <Section title="Contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                name="email"
                label="Email"
                type="email"
                required
                autoComplete="off"
                defaultValue={staff?.email}
                error={fieldError("email")}
              />
              <TextField
                name="phone"
                label="Phone"
                type="tel"
                placeholder="024 000 0000"
                defaultValue={staff?.phone}
                error={fieldError("phone")}
              />
            </div>
          </Section>

          <Section title="Access">
            <Field>
              <FieldLabel>Roles</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {Roles.options().map((role) => (
                  <FieldLabel
                    key={role.value}
                    className="w-full items-center gap-2 rounded-lg border p-2 font-normal"
                  >
                    <Checkbox
                      name="roles"
                      value={role.value}
                      defaultChecked={staff?.roles.includes(role.value)}
                    />
                    {role.label}
                  </FieldLabel>
                ))}
              </div>
              <FieldDescription>
                Roles decide which modules appear once they sign in.
              </FieldDescription>
              <FieldError>{fieldError("roles")}</FieldError>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="station"
                label="Home station"
                items={STATION_ITEMS}
                defaultValue={staff?.station ?? NO_STATION}
                error={fieldError("station")}
              />
              <TextField
                name="specialty"
                label="Specialty"
                placeholder="Paediatrics"
                defaultValue={staff?.specialty}
                error={fieldError("specialty")}
              />
              <TextField
                name="password"
                label={staff ? "New password" : "Password"}
                type="password"
                autoComplete="new-password"
                required={!staff}
                className="sm:col-span-2"
                hint={
                  staff
                    ? "Leave blank to keep the current password."
                    : "At least 6 characters. They can change it after signing in."
                }
                error={fieldError("password")}
              />
            </div>
          </Section>

          <Section title="Professional licence">
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="licenceCouncil"
                label="Council"
                items={COUNCIL_ITEMS}
                defaultValue={staff?.licence?.council ?? "none"}
                error={fieldError("licence.council")}
              />
              <TextField
                name="licenceNumber"
                label="Licence number"
                defaultValue={staff?.licence?.number}
                error={fieldError("licence.number")}
              />
              <TextField
                name="licenceExpiresOn"
                label="Expires"
                type="date"
                className="sm:col-span-2"
                defaultValue={staff?.licence?.expiresAt?.slice(0, 10)}
                hint="Ignored when the council is None."
                error={fieldError("licence.expiresAt")}
              />
            </div>
          </Section>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <SheetClose render={<Button type="button" variant="outline" />}>
            Cancel
          </SheetClose>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" />}
            {staff ? "Save changes" : "Create account"}
          </Button>
        </SheetFooter>
      </Form>
    </>
  );
}

/* -------------------------------------------------------------------------
   Deactivate / reactivate
   ------------------------------------------------------------------------- */

function ConfirmPanel({
  state,
  busy,
  error,
}: {
  state: { mode: "deactivate" | "activate"; staff: Staff };
  busy: boolean;
  error?: string;
}) {
  const { staff } = state;
  const deactivating = state.mode === "deactivate";

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{deactivating ? "Deactivate account" : "Reactivate account"}</SheetTitle>
        <SheetDescription>
          {deactivating
            ? "Sign-in stops. The record stays in the directory."
            : "Sign-in is restored, with the same roles and station."}
        </SheetDescription>
      </SheetHeader>

      <Form method="post" className="flex min-h-0 flex-1 flex-col">
        <input type="hidden" name="intent" value={state.mode} />
        <input type="hidden" name="id" value={staff.id} />

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}

          <div className="space-y-0.5 rounded-lg border p-3">
            <div className="font-medium">{staff.fullName}</div>
            <div className="text-sm text-muted-foreground">
              {staff.staffNumber} · {staff.email}
            </div>
            <div className="text-sm text-muted-foreground">
              {staff.roles.map((role) => Roles.label(role)).join(" · ")}
              {staff.station ? ` · ${Stations.label(staff.station)}` : ""}
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {deactivating
              ? "Their visits, notes and claims stay exactly as they are — this only closes the account. Reactivate any time from the same menu."
              : "They will be able to sign in again immediately."}
          </p>
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <SheetClose render={<Button type="button" variant="outline" />}>
            Cancel
          </SheetClose>
          <Button
            type="submit"
            variant={deactivating ? "destructive" : "default"}
            disabled={busy}
          >
            {busy && <Loader2Icon className="animate-spin" />}
            {deactivating ? "Deactivate account" : "Reactivate account"}
          </Button>
        </SheetFooter>
      </Form>
    </>
  );
}
