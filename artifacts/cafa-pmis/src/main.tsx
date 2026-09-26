import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installFetchInterceptor } from "./lib/offline/fetch-interceptor";
import "./i18n"; // initialise i18next before React renders
// HeroUI first: its layers share Tailwind's names, so anything index.css
// declares in the same layer comes later and wins.
import "@heroui/styles/precompiled.css";
import "./index.css";

installFetchInterceptor(() => {
  const stored = localStorage.getItem("cafa.userId");
  return stored ? parseInt(stored, 10) : null;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
