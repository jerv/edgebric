import { createFileRoute } from "@tanstack/react-router";
import { QueryInterface } from "@/components/employee/QueryInterface";

export const Route = createFileRoute("/")({
  component: QueryInterface,
});
