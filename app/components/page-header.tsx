/**
 * The header every full-page screen inside the shell opens with: a way back,
 * a title, a line saying what this page is for, and a slot for its actions.
 *
 * Registration, the folder, the edit form and the merge screen all use it, so
 * a clerk moving between them keeps the same landmark in the same place.
 */

import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Link } from "react-router";

export function PageHeader({
  title,
  description,
  backTo,
  backLabel,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  backTo: string;
  backLabel: string;
  /** Actions, aligned to the right of the title block. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {backLabel}
        </Link>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
