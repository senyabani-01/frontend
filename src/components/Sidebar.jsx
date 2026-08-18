// =============================================================================
// src/components/Sidebar.jsx
//
// Left-hand navigation used inside a dashboard. It takes a list of
// { key, label, icon } tabs and an activeTab/onChange pair, so the SAME
// component can drive the Admin, Teacher, and Student dashboards even
// though each one has a different set of tabs.
// =============================================================================

export default function Sidebar({ tabs, activeTab, onChange }) {
  return (
    <nav style={styles.nav}>
      {/* Render one button per tab the parent dashboard passed in */}
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab; // Highlight whichever tab is selected
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)} // Tell the parent dashboard which tab was clicked
            style={{
              ...styles.tabButton,
              ...(isActive ? styles.tabButtonActive : {}),
            }}
          >
            <tab.icon size={18} /> {/* lucide-react icon component passed in per tab */}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// Local styles for the sidebar - a vertical stack of pill-shaped buttons.
const styles = {
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "20px 12px",
    width: "220px",
    flexShrink: 0,
    borderRight: "1px solid var(--fp-line)",
    background: "var(--fp-paper)",
  },
  tabButton: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    borderRadius: "10px",
    border: "none",
    background: "transparent",
    color: "var(--fp-ink-soft)",
    fontWeight: 600,
    fontSize: "0.92rem",
    textAlign: "left",
    cursor: "pointer",
  },
  tabButtonActive: {
    background: "var(--fp-forest)",
    color: "white",
  },
};
