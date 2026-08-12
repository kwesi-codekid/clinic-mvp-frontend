/**
 * How an out-of-range observation is shown (T5.1).
 *
 * Every flag on screen comes from the API — the ranges are age-aware and the
 * clinic is accountable to them, so nothing here decides what is abnormal. This
 * module only decides how loud it looks.
 *
 * Colour is never the only signal: each flag carries its wording and its value,
 * so a flag still reads on a monochrome ward screen and to someone who cannot
 * separate red from amber.
 */

import { AlertTriangleIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { compareVitalSeverity, type VitalFlagSeverity } from "~/models/enums";
import { VITAL_BOUNDS, type VitalField, type VitalFlag } from "~/models/vitals";

/* -------------------------------------------------------------------------
   Tone
   ------------------------------------------------------------------------- */

const TONES = {
  critical: {
    icon: TriangleAlertIcon,
    pill: "border-destructive/40 bg-destructive/10 text-destructive",
    field: "border-destructive/60 focus-visible:border-destructive",
    text: "text-destructive",
  },
  warning: {
    icon: AlertTriangleIcon,
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    field: "border-amber-500/60 focus-visible:border-amber-500",
    text: "text-amber-700 dark:text-amber-400",
  },
  info: {
    icon: InfoIcon,
    pill: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
    field: "border-sky-500/50 focus-visible:border-sky-500",
    text: "text-sky-700 dark:text-sky-400",
  },
} as const satisfies Record<
  VitalFlagSeverity,
  { icon: typeof InfoIcon; pill: string; field: string; text: string }
>;

/** Border classes for the input a flag belongs to. */
export function flagFieldClass(severity: VitalFlagSeverity | undefined): string | undefined {
  return severity ? TONES[severity].field : undefined;
}

/** Text colour for a flag's own wording. */
export function flagTextClass(severity: VitalFlagSeverity): string {
  return TONES[severity].text;
}

/* -------------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------------- */

/** The API's wording plus the value that triggered it — `Fever · 39.2 °C`. */
export function FlagPill({ flag, className }: { flag: VitalFlag; className?: string }) {
  const tone = TONES[flag.severity];
  const Icon = tone.icon;
  const unit = VITAL_BOUNDS[flag.field as VitalField]?.unit;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        tone.pill,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span>{flag.label}</span>
      <span className="font-normal opacity-80">
        {flag.value}
        {unit ? ` ${unit}` : ""}
      </span>
    </span>
  );
}

/**
 * Every flag on a set, loudest first.
 *
 * Renders nothing when there are none — an empty flag list means "nothing to
 * report", and a cheerful "all normal" badge would overstate what was actually
 * measured. The caller says that in words if it wants to.
 */
export function FlagList({
  flags,
  className,
}: {
  flags: readonly VitalFlag[];
  className?: string;
}) {
  if (flags.length === 0) return null;

  const ordered = [...flags].sort((a, b) => compareVitalSeverity(a.severity, b.severity));

  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {ordered.map((flag, index) => (
        <li key={`${flag.field}-${flag.label}-${index}`}>
          <FlagPill flag={flag} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The flags belonging to one reading, shown under its input.
 *
 * Deliberately beneath the field rather than in a summary at the bottom: the
 * nurse is looking at the number she just typed, and that is where the answer
 * has to be.
 */
export function FieldFlags({ flags }: { flags: readonly VitalFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium">
      {flags.map((flag, index) => (
        <span key={`${flag.label}-${index}`} className={flagTextClass(flag.severity)}>
          {flag.label}
        </span>
      ))}
    </p>
  );
}
