// =============================================================================
// src/components/ProtectedRoute.jsx
//
// Wraps a page and only renders it if the logged-in user has one of the
// allowed roles. Otherwise it redirects to /login. This is a FRONTEND
// convenience only - it stops people from casually browsing to a URL they
// shouldn't see, but it is NOT a security boundary. The FastAPI backend
// must independently re-check the JWT's role on every protected endpoint,
// because a determined user can always bypass frontend checks.
// =============================================================================

import { Navigate } from "react-router-dom"; // Declarative redirect component from react-router
import { useAuth } from "../context/AuthContext"; // Read the current logged-in user/role

// Usage: <ProtectedRoute allowedRoles={["admin"]}><AdminDashboard /></ProtectedRoute>
export default function ProtectedRoute({ allowedRoles, children }) {
  const { user, role } = useAuth(); // Pull current session info from context

  // No one logged in at all -> bounce to the login page.
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Logged in, but their role isn't allowed on this page -> send them to
  // their own dashboard instead of showing a confusing blank/forbidden page.
  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={`/${role}`} replace />;
  }

  // Passed both checks - render the actual page.
  return children;
}
