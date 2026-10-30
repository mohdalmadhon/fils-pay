import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AdminAuthProvider } from "./auth/AdminAuthContext.js";
import { router } from "./router.js";
import { initTheme } from "./components/kit/theme.js";
import { HalloweenToggle, initCostume } from "./components/kit/Halloween.js";
// The costume's pixel font, bundled (no third-party request). The browser
// only downloads it when the costume is on.
import "@fontsource/pixelify-sans/latin-500.css";
import "@fontsource/pixelify-sans/latin-600.css";
import "./theme.css";
import "./admin.css";

// Light or night, and the costume, decided before the first paint.
initTheme();
initCostume();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AdminAuthProvider>
      <RouterProvider router={router} />
    <HalloweenToggle />
    </AdminAuthProvider>
  </React.StrictMode>,
);
