import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";
import { registerMobilePwa, watchInstallPrompt } from "./pwa/install";
import { BrandProvider } from "./hooks/useBrand";

// Register the warehouse PWA shell (only attaches under /m/*) and
// start watching for the install prompt so the mobile UI can offer
// "Add to Home Screen" at the right moment.
registerMobilePwa();
watchInstallPrompt();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <BrandProvider>
        <App />
      </BrandProvider>
    </BrowserRouter>
  </React.StrictMode>
);
