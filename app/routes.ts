import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/extract-titles", "routes/api/extract-titles.tsx"),
  route("api/parse-iss", "routes/api/parse-iss.ts"),
] satisfies RouteConfig;
