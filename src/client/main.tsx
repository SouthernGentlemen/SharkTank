import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "module-react3fiber/app";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
