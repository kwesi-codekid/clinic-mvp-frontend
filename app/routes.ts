import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Everything inside the app shell requires a signed-in staff member.
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("staff", "routes/staff.tsx"),
    // Unbuilt sidebar modules land on a placeholder until their route exists.
    route("*", "routes/coming-soon.tsx"),
  ]),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // The shadcn kit that shipped with the template, kept as a component reference.
  route("ui-kit", "routes/ui-kit.tsx"),
] satisfies RouteConfig;
