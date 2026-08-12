import { ActivityIcon } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getHealth } from "~/lib/api/platform";
import { throwRouteError } from "~/lib/api/route-error";
import { requireStaff } from "~/lib/auth.server";
import type { Health } from "~/models/platform";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Clinic" },
    { name: "description", content: "Clinic management" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { staff } = await requireStaff(request);
  try {
    return { staff, health: await getHealth() };
  } catch (error) {
    throwRouteError(error);
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const CHECK_LABELS: Record<keyof Health["checks"], string> = {
  database: "Database",
  databaseWritable: "Database writable",
  realtime: "Realtime",
  ai: "Assistant",
};

function checkIsHealthy(value: string | boolean): boolean {
  return value === "up" || value === true || value === "enabled";
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { staff, health } = loaderData;
  const healthy = health.status === "ok";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {staff.fullName}. Modules appear here as they land.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <ActivityIcon className="size-4" />
                Backend
              </CardTitle>
              <CardDescription>
                {health.environment} · v{health.version} · up {formatUptime(health.uptimeSeconds)}
              </CardDescription>
            </div>
            <Badge variant={healthy ? "default" : "destructive"}>
              {healthy ? "Healthy" : "Degraded"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(CHECK_LABELS) as Array<keyof Health["checks"]>).map((key) => {
              const value = health.checks[key];
              return (
                <div key={key} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{CHECK_LABELS[key]}</dt>
                  <dd className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={
                        checkIsHealthy(value)
                          ? "size-2 rounded-full bg-chart-3"
                          : "size-2 rounded-full bg-destructive"
                      }
                    />
                    <span className="font-mono text-xs">
                      {typeof value === "boolean" ? (value ? "yes" : "no") : value}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
