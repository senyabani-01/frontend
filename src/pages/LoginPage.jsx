// =============================================================================
// src/pages/LoginPage.jsx
//
// A single login form used by ALL THREE roles (admin, teacher, student).
// The backend tells us which role the account has, and we redirect to the
// matching dashboard - the frontend never needs to know in advance who is
// logging in.
//
// NOTE: Public self-service registration ("New prospective student?
// Register here" -> /register) has been removed. Student accounts are now
// created exclusively by an admin, from the Students tab of AdminDashboard.jsx.
//
// "MAKE SURE IT DISPLAYS" - hardening notes:
// This page is the very first thing anyone sees, so it must never white-
// screen the app. Two things could previously make that happen:
//   1. A missing image file breaking the Vite build (see the photo-glob
//      note below - already handled defensively).
//   2. useAuth() throwing if LoginPage is ever rendered outside its
//      <AuthProvider> (e.g. during a refactor, or a stray route). login()
//      is now read defensively so a missing/broken auth context degrades
//      to a disabled form with a visible message instead of a blank page.
//
// LEFT PANEL PHOTO - WHY THIS IS DIFFERENT FROM BEFORE:
// A plain `import studentMicroscope from "../assets/student-microscope.jpg"`
// is resolved by Vite at BUILD time. If that exact file isn't physically
// sitting in src/assets/ in your project, the entire app fails to build
// with "Failed to resolve import" - that's what happened twice now. No
// code change can make a missing file "work"; the file has to actually
// exist on disk.
//
// What this version does instead: import.meta.glob() below scans your
// src/assets/ folder AT BUILD TIME for anything named student-microscope.*
// (any of jpg/jpeg/png/webp). If it finds one, that photo is used. If it
// doesn't find one, photoUrl is simply null and the page falls back to the
// same plain forest-green gradient it always had - no crash either way.
// This means:
//   1) The build can never fail because of this image again.
//   2) To actually show your photo, put the file at
//      src/assets/student-microscope.jpg (or .jpeg/.png/.webp) in your
//      project folder - once it's there, it appears automatically, no
//      code change needed.
//
// THE ACTUAL BUG THAT WAS BLANKING THE LOGIN PAGE:
// The crest/logo used to be a plain `import logo from "../assets/logo.jpg"`.
// That's resolved by Vite at BUILD time, exactly like the microscope photo
// used to be - so if logo.jpg wasn't physically present in src/assets/,
// the whole app failed to build with "Failed to resolve import" and NOTHING
// rendered, including this login page, even though the login page's own
// code was fine. It is now resolved the same crash-proof way as the
// microscope photo below: import.meta.glob() scans src/assets/ at build
// time for logo.(jpg|jpeg|png|webp); if none is found, logoPhoto is simply
// null and the page falls back to a plain text "FPA" crest badge instead
// of failing to build.
// =============================================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Matches src/assets/logo.jpg, .jpeg, .png, or .webp if any of them exist -
// and resolves to null (never throws, never fails the build) if none do.
let logo = null;
try {
  const logoModules = import.meta.glob("../assets/logo.jpg",{ eager: true });
  const firstLogoModule = Object.values(logoModules)[0];
  logo = firstLogoModule ? (firstLogoModule.default ?? firstLogoModule) : null;
} catch {
  logo = null;
}

// Matches src/assets/student-microscope.jpg, .jpeg, .png, or .webp if any
// of them exist - and resolves to an empty object (not an error) if none
// of them do.
let studentMicroscopePhoto = null;
try {
  const microscopePhotoModules = import.meta.glob("../assets/student-microscope.jpg", { eager: true });
  const firstPhotoModule = Object.values(microscopePhotoModules)[0];
  studentMicroscopePhoto = firstPhotoModule ? (firstPhotoModule.default ?? firstPhotoModule) : null;
} catch {
  // Glob import failing for any environment-specific reason should never
  // take the whole login page down with it - just show the plain gradient.
  studentMicroscopePhoto = null;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  // useAuth() should always be available under <AuthProvider>, but this
  // page must render (with a clear message) rather than crash if it's ever
  // mounted outside that provider or the context throws during setup.
  let auth = null;
  let authError = "";
  try {
    auth = useAuth();
  } catch (err) {
    authError = "Sign-in isn't available right now. Please refresh the page or contact an administrator.";
  }
  const login = auth?.login;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!login) {
      setError(authError || "Sign-in isn't available right now. Please refresh the page.");
      return;
    }

    if (!email.trim() || !password) {
      setError("Please enter both your email and password.");
      return;
    }

    setLoading(true);
    try {
      const user = await login(email, password); // Calls POST /api/auth/login via AuthContext
      if (!user || !user.role) {
        setError("Signed in, but no role was returned. Please contact an administrator.");
        return;
      }
      navigate(`/${user.role}`); // Redirect to /admin, /teacher, or /student based on the response
    } catch (err) {
      // FastAPI typically returns { detail: "..." } on auth errors (401/400)
      setError(err.response?.data?.detail || "Could not log in. Check your email and password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      {/* Left panel: the school's green gradient is always the base layer,
          so the panel looks right with or without a photo. If
          student-microscope.(jpg|jpeg|png|webp) exists in src/assets/, it's
          layered on top with the gradient as a semi-transparent overlay;
          otherwise it's just the plain gradient, same as the very first
          version of this page. The crest + wordmark are unaffected either way. */}
      <div style={styles.leftPanel}>
        {studentMicroscopePhoto && (
          <img
            src={studentMicroscopePhoto}
            alt="Forest Park Academy student examining a specimen under a microscope in the science lab"
            style={styles.leftPhoto}
          />
        )}
        <div style={studentMicroscopePhoto ? styles.leftOverlayOnPhoto : styles.leftOverlayPlain} />
        <div style={styles.leftPanelContent}>
          {logo ? (
            <img src={logo} alt="Forest Park Academy crest" style={styles.crest} />
          ) : (
            <div style={styles.crestFallback} aria-label="Forest Park Academy crest">FPA</div>
          )}
          <h1 style={styles.heading}>Forest Park Academy</h1>
          <p style={styles.subheading}>Specialist School of Science &amp; Technology</p>
          <p style={styles.motto}>FPA Analytics &middot; Cognitionis Fonte</p>
        </div>
      </div>

      {/* Right panel: the actual login form */}
      <div style={styles.rightPanel}>
        <form onSubmit={handleSubmit} className="fp-card" style={styles.form}>
          <h2 style={{ marginBottom: 4 }}>Sign in</h2>
          <p style={{ color: "var(--fp-ink-soft)", marginBottom: 20, fontSize: "0.9rem" }}>
            Welcome to FPA Analytics
          </p>

          {(error || authError) && (
            <div style={styles.errorBox} role="alert">
              {error || authError}
            </div>
          )}

          <label className="fp-label" htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            required
            className="fp-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@fpa.ac.zw"
            style={{ marginBottom: 14 }}
            autoComplete="username"
            disabled={!!authError}
          />

          <label className="fp-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            className="fp-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ marginBottom: 20 }}
            autoComplete="current-password"
            disabled={!!authError}
          />

          <button
            type="submit"
            className="fp-btn fp-btn-primary"
            disabled={loading || !!authError}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: { display: "flex", minHeight: "100vh", flexWrap: "wrap" },
  leftPanel: {
    flex: "1 1 320px",
    position: "relative",
    overflow: "hidden",
    minHeight: 280,
    // Always present as the base layer - this is what shows if no photo
    // file is found, so the panel never looks broken or blank.
    background: "linear-gradient(180deg, var(--fp-forest, #1b4332) 0%, var(--fp-forest-dark, #0a241a) 100%)",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  // Only rendered when a photo file was actually found at build time.
  leftPhoto: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  // Layered over the photo so the panel still reads as forest-green.
  leftOverlayOnPhoto: {
    position: "absolute",
    inset: 0,
    background: "linear-gradient(180deg, rgba(27,67,50,0.82) 0%, rgba(10,36,26,0.9) 100%)",
  },
  // No photo found - nothing extra needed on top of the panel's own
  // gradient background, so this stays fully transparent.
  leftOverlayPlain: {
    position: "absolute",
    inset: 0,
    background: "transparent",
  },
  leftPanelContent: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  },
  crest: { width: 120, height: 120, borderRadius: "50%", marginBottom: 24, background: "white", padding: 8 },
  // Shown instead of <img> when no logo file is found in src/assets/, so a
  // missing crest image degrades to a styled badge rather than a broken
  // image icon (and, more importantly, never a failed build).
  crestFallback: {
    width: 120,
    height: 120,
    borderRadius: "50%",
    marginBottom: 24,
    background: "white",
    color: "var(--fp-forest, #1b4332)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "1.6rem",
    letterSpacing: "0.04em",
  },
  heading: { color: "white", fontSize: "2.1rem", margin: 0 },
  subheading: { color: "rgba(255,255,255,0.75)", marginTop: 6, fontSize: "0.95rem" },
  motto: { color: "var(--fp-gold, #e0a458)", marginTop: 14, fontSize: "0.85rem", letterSpacing: "0.06em", textTransform: "uppercase" },
  rightPanel: { flex: "1 1 320px", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  form: { width: "100%", maxWidth: 380 },
  errorBox: {
    background: "rgba(179, 65, 58, 0.1)",
    color: "var(--fp-danger)",
    padding: "10px 14px",
    borderRadius: "var(--fp-radius-sm)",
    fontSize: "0.88rem",
    marginBottom: 16,
  },
};
