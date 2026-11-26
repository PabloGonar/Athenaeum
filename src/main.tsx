import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { QuickCaptureOverlay } from "./components/QuickCaptureOverlay";

const isQuickCaptureWindow =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("window") === "quick-capture";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isQuickCaptureWindow ? <QuickCaptureOverlay standalone open /> : <App />}
  </StrictMode>
);
