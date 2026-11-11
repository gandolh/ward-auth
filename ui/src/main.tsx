import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { App } from "./app.js";
import { startTheme } from "./theme.js";

/**
 * The Vite entry point, and deliberately the whole of it.
 *
 * Routing, layout and every page live in `app.tsx` —
 * keeping this file to a mount means the sign-in side and the console never both need to edit
 * the same file to add a screen.
 *
 * `StrictMode` is on. It double-invokes effects in development, which is the
 * behaviour that surfaces exactly the class of bug Ward has already had to fix
 * once: two refresh calls firing at the same moment. Leave it on.
 */
startTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("Ward UI: #root is missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
