import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/identra-ai")({
  component: () => <Navigate to="/snare-ai" replace />,
});