/**
 * Sign out. POST-only — a link that logged people out on GET would let any
 * prefetch or crawler end a session.
 */

import { redirect } from "react-router";

import { logoutSession } from "~/lib/auth.server";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  return logoutSession(request);
}

export async function loader() {
  return redirect("/");
}
