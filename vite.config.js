// vite.config.js
// This file tells Vite (our build tool) how to bundle the React app.
import { defineConfig } from "vite";       // defineConfig gives us autocomplete/type-checking for the config object
import react from "@vitejs/plugin-react";  // Official Vite plugin that adds React support (JSX, Fast Refresh, etc.)

// Export the Vite configuration
export default defineConfig({
  plugins: [react()], // Register the React plugin so .jsx files compile correctly
  server: {
    port: 5173,        // Local dev server port -> app will run at http://localhost:5173
    proxy: {
      // Any request the frontend makes to "/api/..." during development
      // gets forwarded to the FastAPI backend below. This avoids CORS issues
      // while developing locally. Update the target to match where your
      // FastAPI server is running (default FastAPI/uvicorn port is 8000).
      "/api": {
        target: "http://127.0.0.1:8000", // <-- change this to your FastAPI server's address
        changeOrigin: true,              // Makes the proxy pretend requests come from the target's origin
        secure: false,                   // Allow proxying to a non-HTTPS backend during development
      },
    },
  },
});
