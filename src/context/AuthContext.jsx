// =============================================================================
// src/context/AuthContext.jsx
//
// A React Context that holds "who is currently logged in" (their name, role,
// and JWT) so any component in the tree can read it with useAuth() instead
// of passing props down through every layer. This is what powers role-based
// views: Admin, Teacher, and Student each see a different dashboard because
// they read `role` from this same context.
// =============================================================================

import { createContext, useContext, useState, useCallback } from "react"; // React context/state primitives
import { login as apiLogin, logout as apiLogout } from "../api/api";      // Our FastAPI login/logout calls

// Create the context object itself. Components can't use this directly -
// they use the useAuth() hook defined below instead.
const AuthContext = createContext(null);

// AuthProvider wraps the whole app (see App.jsx) so every page can access
// auth state and functions.
export function AuthProvider({ children }) {
  // Try to restore a previously logged-in user from localStorage so a page
  // refresh doesn't log the user out. JSON.parse turns the saved string
  // back into a real object; if nothing was saved, default to null.
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("fp_user");
    return saved ? JSON.parse(saved) : null;
  });

  // login(): calls the backend, stores the returned token + user profile,
  // and updates React state so the whole app re-renders as "logged in".
  const login = useCallback(async (email, password) => {
    const response = await apiLogin(email, password);
    // The backend is expected to return { access_token, role, user }
    const { access_token, role, user: profile } = response.data;

    const fullUser = { ...profile, role }; // Merge role into the profile object for convenience

    localStorage.setItem("fp_access_token", access_token); // Persist JWT for future requests
    localStorage.setItem("fp_user", JSON.stringify(fullUser)); // Persist profile so refresh keeps them logged in
    setUser(fullUser); // Trigger a re-render across the app

    return fullUser; // Return to the caller (LoginPage) so it can redirect by role
  }, []);

  // logout(): clears both the backend session (if applicable) and local state.
  const logout = useCallback(async () => {
    await apiLogout(); // Also clears localStorage internally (see api.js)
    setUser(null);      // Triggers re-render back to the logged-out state
  }, []);

  // The value every consumer of useAuth() receives.
  const value = { user, role: user?.role ?? null, login, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook for reading auth state anywhere: const { user, role } = useAuth();
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Fails loudly during development if a component tries to use this
    // outside of <AuthProvider>, instead of silently returning undefined.
    throw new Error("useAuth must be used inside an <AuthProvider>");
  }
  return ctx;
}
