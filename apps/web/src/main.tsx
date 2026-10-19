import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./styles/tokens.css";
import "./styles/app.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
