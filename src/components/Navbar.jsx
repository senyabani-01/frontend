// =============================================================================
// src/components/Navbar.jsx
//
// Top bar shown on every logged-in page: crest + school name on the left,
// the current user's name/role badge and a logout button on the right.
// =============================================================================

import { useNavigate } from "react-router-dom"; // Lets us push the user to /login after logout
import { useAuth } from "../context/AuthContext"; // Current user + logout() function
import logo from "../assets/logo.jpg"; // The Forest Park Academy crest image supplied by the school

export default function Navbar() {
  const { user, logout } = useAuth(); // Grab the logged-in user and the logout action
  const navigate = useNavigate();      // Router hook used to redirect after logging out

  // Handles the logout button click: calls the backend/context logout,
  // then sends the user back to the login screen.
  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <header style={styles.header}>
      {/* Left side: crest image + school name, doubles as a "home" link */}
      <div style={styles.brand}>
        <img src={logo} alt="Forest Park Academy crest" style={styles.logo} />
        <div>
          <div style={styles.schoolName}>Forest Park Academy</div>
          <div style={styles.motto}>Cognitionis Fonte</div>
        </div>
      </div>

      {/* Right side: who's logged in + their role + logout control */}
      {user && (
        <div style={styles.userArea}>
          <div style={styles.userInfo}>
            <div style={styles.userName}>{user.fullName || user.name}</div>
            <span className={`fp-badge fp-badge-green`}>{user.role}</span>
          </div>
          <button className="fp-btn fp-btn-ghost" onClick={handleLogout}>
            Log out
          </button>
        </div>
      )}
    </header>
  );
}

// Inline style object for this component. Kept local (not global CSS)
// because the navbar's layout is only ever used in exactly this one place.
const styles = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 28px",
    background: "var(--fp-paper)",
    borderBottom: "1px solid var(--fp-line)",
  },
  brand: { display: "flex", alignItems: "center", gap: "12px" },
  logo: { width: 44, height: 44, borderRadius: "50%", objectFit: "cover" },
  schoolName: { fontFamily: "var(--fp-font-display)", fontWeight: 600, color: "var(--fp-forest-dark)" },
  motto: { fontSize: "0.72rem", color: "var(--fp-ink-soft)", letterSpacing: "0.04em", textTransform: "uppercase" },
  userArea: { display: "flex", alignItems: "center", gap: "14px" },
  userInfo: { textAlign: "right" },
  userName: { fontWeight: 600, fontSize: "0.9rem" },
};
