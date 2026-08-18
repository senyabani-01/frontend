// =============================================================================
// src/App.jsx
//
// Defines every route in the app and which component renders at each URL.
// Wraps everything in <AuthProvider> so any page can read the logged-in
// user, and guards the three dashboards with <ProtectedRoute> so only the
// matching role can view each one.
//
// NOTE: Public self-service registration (/register -> RegisterPage) has
// been removed. Student accounts are now created exclusively by an admin,
// from the Students tab of AdminDashboard.jsx. Anyone who still hits
// /register (an old bookmark, a stale link) falls through to the wildcard
// route below and lands on /login.
// =============================================================================

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import LoginPage from "./pages/LoginPage";
import AdminDashboard from "./pages/AdminDashboard";
import TeacherDashboard from "./pages/TeacherDashboard";
import StudentDashboard from "./pages/StudentDashboard";

export default function App() {
  return (
    // AuthProvider must wrap the router so every page inside it can call useAuth()
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public route - anyone can reach this without logging in */}
          <Route path="/login" element={<LoginPage />} />

          {/* Admin-only dashboard */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Teacher-only dashboard */}
          <Route
            path="/teacher"
            element={
              <ProtectedRoute allowedRoles={["teacher"]}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />

          {/* Student-only dashboard */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={["student"]}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />

          {/* Any unknown URL (including the old /register) falls back to the login page */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
