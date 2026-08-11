import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // The shadcn kit that shipped with the template, kept as a component reference.
  route("ui-kit", "routes/ui-kit.tsx"),
] satisfies RouteConfig;
