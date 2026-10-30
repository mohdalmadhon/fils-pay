import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { initTheme } from "./components/kit/theme.js";
import { HalloweenToggle, initCostume } from "./components/kit/Halloween.js";
// Display faces for the three designs. Each only downloads when used.
import "@fontsource-variable/unbounded/index.css";
import "@fontsource-variable/bricolage-grotesque/index.css";
import "@fontsource-variable/lexend/index.css";
import "./theme.css";
import "./dashboard.css";

// Light or night, and the costume, decided before the first paint.
initTheme();
initCostume();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <HalloweenToggle />
  </React.StrictMode>,
);
