// =============================================================================
// src/main.jsx
// The very first JavaScript that runs. It finds the <div id="root"> from
// index.html and renders our <App /> component tree into it.
// =============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css"; // Global styles/design tokens - imported once, here, for the whole app

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* StrictMode double-invokes some functions in development to help
        catch bugs early - it has no effect on the production build. */}
    <App />
  </React.StrictMode>
);
