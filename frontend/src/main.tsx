import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "./styles.css";
import { router } from "./router";
import { ScanProvider } from "@/lib/scan";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root")!;

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <ScanProvider>
          <RouterProvider router={router} />
        </ScanProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
