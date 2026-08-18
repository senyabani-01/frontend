// =============================================================================
// src/pages/StudentDashboard.jsx
//
// What a logged-in student sees: their class & class teacher, the subjects
// they're enrolled in, their published results grouped by exam (read-only -
// students can never edit a mark or comment), and a trend chart comparing
// their average score across subjects over time. Results can be downloaded
// as a themed, watermarked PDF.
// =============================================================================

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { FileText, TrendingUp, BookOpen, Download } from "lucide-react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import { studentGetProfile, studentListResults, studentGetTrends } from "../api/api";

// BUILD-SAFETY: this used to be a plain `import schoolLogo from
// "../assets/logo.jpg"`, which Vite resolves at BUILD time - if that exact
// file wasn't on disk in src/assets/, the whole app failed to build (not
// just this page). The watermark/header code below already wraps its use
// of schoolLogo in try/catch, but that only helps once the app has
// actually built. Resolving it via import.meta.glob (same technique as
// LoginPage.jsx) means a missing logo file just means no watermark - never
// a broken build.
let schoolLogo = null;
try {
  const logoModules = import.meta.glob("../assets/logo.jpg", { eager: true });
  const firstLogoModule = Object.values(logoModules)[0];
  schoolLogo = firstLogoModule ? (firstLogoModule.default ?? firstLogoModule) : null;
} catch {
  schoolLogo = null;
}

// FastAPI returns { detail: "..." } for normal errors or
// { detail: [{ loc, msg, type }] } for a 422 validation error - this reads
// either shape into one readable string instead of "[object Object]".
function getErrorMessage(err, fallback = "Something went wrong. Please try again.") {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message || fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join(" ");
  }
  return fallback;
}

// -----------------------------------------------------------------------------
// Cambridge-style grade band shown next to every percentage score - kept in
// sync with the same table used on TeacherDashboard.jsx. If this ever moves
// into a shared "src/lib/grading.js" module, update the import in both
// files instead of the table itself.
// -----------------------------------------------------------------------------
const CAMBRIDGE_GRADE_BANDS = [
  { min: 90, grade: "A*" },
  { min: 80, grade: "A" },
  { min: 70, grade: "B" },
  { min: 60, grade: "C" },
  { min: 50, grade: "D" },
  { min: 40, grade: "E" },
  { min: 30, grade: "F" },
  { min: 20, grade: "G" },
  { min: 0, grade: "U" },
];
function cambridgeGrade(score) {
  if (score === "" || score === null || score === undefined) return "";
  const num = Number(score);
  if (Number.isNaN(num)) return "";
  const band = CAMBRIDGE_GRADE_BANDS.find((b) => num >= b.min);
  return band ? band.grade : "";
}
function GradeBadge({ score }) {
  const grade = cambridgeGrade(score);
  if (!grade) return null;
  const tone = ["A*", "A"].includes(grade) ? "fp-badge-green" : ["U", "G", "F"].includes(grade) ? "fp-badge-red" : "fp-badge-gold";
  return (
    <span className={`fp-badge ${tone}`} style={{ marginLeft: 8, fontWeight: 700 }}>
      {grade}
    </span>
  );
}

// The school runs two parallel classes per form - "Green" and "Yellow" -
// from Form 1 through Upper Six, encoded into the backend's single
// `grade_level` string, e.g. "Form 3 Green". These two helpers split it
// back apart for display.
const STREAMS = ["Green", "Yellow"];
function getStream(gradeLevel = "") {
  const parts = gradeLevel.trim().split(" ");
  const last = parts[parts.length - 1];
  return STREAMS.includes(last) ? last : "";
}
function getForm(gradeLevel = "") {
  const stream = getStream(gradeLevel);
  return stream ? gradeLevel.slice(0, gradeLevel.length - stream.length).trim() : gradeLevel;
}

const TABS = [
  { key: "subjects", label: "My subjects", icon: BookOpen },
  { key: "results", label: "My results", icon: FileText },
  { key: "trends", label: "Trends", icon: TrendingUp },
];

// FPA Analytics theme - the same forest green and gold used on LoginPage.jsx,
// reused here so the downloaded PDF matches the app rather than looking like
// a generic export.
const FPA_GREEN = [27, 67, 50]; // #1b4332
const FPA_GREEN_DARK = [10, 36, 26]; // #0a241a
const FPA_GOLD = [224, 164, 88]; // #e0a458
const LINE_COLORS = ["#1b4332", "#e0a458", "#2d6a4f", "#b3413a", "#7c9885", "#8a5a2b"];

export default function StudentDashboard() {
  const [activeTab, setActiveTab] = useState("subjects");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />
      <div style={{ display: "flex", flex: 1 }}>
        <Sidebar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
        <main style={{ flex: 1, padding: "28px 32px", overflow: "auto" }}>
          <ClassBanner />
          {activeTab === "subjects" && <SubjectsPanel />}
          {activeTab === "results" && <ResultsPanel />}
          {activeTab === "trends" && <TrendsPanel />}
        </main>
      </div>
    </div>
  );
}

function LoadErrorBanner({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="fp-card"
      style={{
        marginTop: 16,
        background: "rgba(179, 65, 58, 0.08)",
        borderColor: "var(--fp-danger)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ color: "var(--fp-danger)", fontSize: "0.9rem" }}>{message}</span>
      {onRetry && (
        <button type="button" className="fp-btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// CLASS BANNER: the student's class (form + stream) and class teacher, shown
// above every tab. classTeacherName is read straight off the profile response
// if the backend provides it - it's hidden automatically if not, since
// UserOut/student profile doesn't currently model a homeroom/class teacher
// (only per-subject TeacherClass assignments exist). Add a classTeacherName
// field to the backend's student profile response to populate this.
// -----------------------------------------------------------------------------
function ClassBanner() {
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    studentGetProfile() // GET /api/student/profile
      .then((res) => setProfile(res.data))
      .catch((err) => setLoadError(getErrorMessage(err, "")));
  }, []);

  if (loadError || !profile) return null;

  const stream = getStream(profile.gradeLevel);
  const form = getForm(profile.gradeLevel);

  return (
    <div className="fp-card" style={{ marginBottom: 20, display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: "0.75rem", color: "var(--fp-ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Class</div>
        <div style={{ fontWeight: 600 }}>
          {form} {stream && <span className={`fp-badge ${stream === "Green" ? "fp-badge-green" : "fp-badge-gold"}`} style={{ marginLeft: 6 }}>{stream}</span>}
        </div>
      </div>
      {profile.classTeacherName && (
        <div>
          <div style={{ fontSize: "0.75rem", color: "var(--fp-ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Class teacher</div>
          <div style={{ fontWeight: 600 }}>{profile.classTeacherName}</div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// SUBJECTS PANEL: subjects the student has at least one published result for.
// (There's no standalone "subjects I'm enrolled in" endpoint on the backend
// yet, so this is derived from published results - a subject the student
// hasn't been marked in yet won't appear until it does.)
// -----------------------------------------------------------------------------
function SubjectsPanel() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await studentListResults(); // GET /api/student/results
      setResults(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load your subjects. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const subjects = [...new Set(results.map((r) => r.subject))].sort();

  return (
    <section>
      <h2 style={{ marginBottom: 4 }}>My subjects</h2>
      <p style={{ color: "var(--fp-ink-soft)", fontSize: "0.92rem", marginBottom: 20 }}>
        Subjects you currently have published results in.
      </p>
      {loading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading…</p>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} onRetry={load} />
      ) : subjects.length === 0 ? (
        <div className="fp-card fp-empty">No subjects to show yet - they'll appear once a teacher's results are published.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {subjects.map((subject) => (
            <div key={subject} className="fp-card" style={{ padding: "14px 18px", fontWeight: 600 }}>{subject}</div>
          ))}
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// RESULTS PANEL: published exam results, grouped by exam sitting. Read-only -
// there is nothing here a student can edit, and each exam card can be
// downloaded as a themed PDF (subject, mark + Cambridge grade, and teacher
// comment for that sitting) carrying the school crest and a faint watermark.
// -----------------------------------------------------------------------------
function ResultsPanel() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [downloadingKey, setDownloadingKey] = useState(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await studentListResults(); // GET /api/student/results
      setResults(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load your results. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Groups the flat /api/student/results list into one card per exam sitting.
  const examGroups = groupByExam(results);

  // Loads an <img>-able source into a base64 data URL that jsPDF's
  // addImage() can embed. Wrapped so a broken/missing logo file never
  // blocks the rest of the PDF from generating.
  function loadImageAsDataUrl(src) {
    return new Promise((resolve, reject) => {
      if (!src) {
        reject(new Error("No logo file found"));
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  async function downloadPdf(examKey, examName, term, subjects, studentName) {
    setDownloadingKey(examKey);
    try {
      // jsPDF + jspdf-autotable render the PDF entirely client-side - add
      // both packages ("jspdf", "jspdf-autotable") to package.json.
      //
      // FIX: this is what was throwing "Could not generate the PDF."
      // jspdf-autotable v3+ no longer reliably patches doc.autoTable()
      // onto the jsPDF prototype as a side effect under bundlers like
      // Vite - it exports a plain function instead. Calling
      // doc.autoTable(...) (the old API) throws "doc.autoTable is not a
      // function", which landed in the catch block below as a generic
      // failure. Import the function and call it as autoTable(doc, {...})
      // instead - this works across jspdf-autotable v3, v4, and v5.
      const { default: jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = autoTableModule.default || autoTableModule;

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // --- Watermark: a large, faint crest centred behind everything else.
      // Drawn first, on its own graphics state, so it never obscures the
      // header, table, or footer that get drawn on top of it. Any failure
      // here (e.g. the logo file not resolving in this build) is caught
      // and silently skipped - a missing watermark should never stop the
      // PDF from downloading.
      try {
        const logoDataUrl = await loadImageAsDataUrl(schoolLogo);
        const wmSize = 130;
        if (typeof doc.saveGraphicsState === "function" && doc.GState) {
          doc.saveGraphicsState();
          doc.setGState(new doc.GState({ opacity: 0.07 }));
          doc.addImage(logoDataUrl, "PNG", (pageWidth - wmSize) / 2, (pageHeight - wmSize) / 2, wmSize, wmSize);
          doc.restoreGraphicsState();
        } else {
          // Older jsPDF without GState support - still place the crest,
          // just without transparency, rather than skip it entirely.
          doc.addImage(logoDataUrl, "PNG", (pageWidth - wmSize) / 2, (pageHeight - wmSize) / 2, wmSize, wmSize);
        }
      } catch {
        // No watermark this time - the rest of the PDF still generates fine.
      }

      // --- Header band in FPA forest green, with the crest and theme line.
      doc.setFillColor(...FPA_GREEN);
      doc.rect(0, 0, pageWidth, 32, "F");
      try {
        const logoDataUrl = await loadImageAsDataUrl(schoolLogo);
        doc.addImage(logoDataUrl, "PNG", 12, 6, 20, 20);
      } catch {
        // Header still reads fine without the crest thumbnail.
      }
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(15);
      doc.text("Forest Park Academy", 38, 15);
      doc.setFontSize(9);
      doc.setTextColor(...FPA_GOLD);
      doc.text("FPA Analytics  \u00B7  Cognitionis Fonte", 38, 22);

      // --- Gold divider + student/exam details.
      doc.setDrawColor(...FPA_GOLD);
      doc.setLineWidth(1);
      doc.line(0, 32, pageWidth, 32);

      doc.setTextColor(...FPA_GREEN_DARK);
      doc.setFontSize(12);
      doc.text(`${examName} \u2014 ${term}`, 14, 42);
      if (studentName) {
        doc.setFontSize(10);
        doc.setTextColor(90, 90, 90);
        doc.text(`Student: ${studentName}`, 14, 49);
      }

      autoTable(doc, {
        startY: studentName ? 55 : 48,
        head: [["Subject", "Mark (%)", "Grade", "Teacher comment"]],
        body: subjects.map((s) => [s.subject, `${s.score}`, cambridgeGrade(s.score) || "-", s.comment || ""]),
        styles: { fontSize: 9, cellWidth: "wrap" },
        headStyles: { fillColor: FPA_GREEN, textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [245, 247, 244] },
        columnStyles: { 3: { cellWidth: 90 } },
      });

      // --- Footer with the grading key, on every page.
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(...FPA_GOLD);
        doc.setLineWidth(0.5);
        doc.line(14, pageHeight - 18, pageWidth - 14, pageHeight - 18);
        doc.setFontSize(7.5);
        doc.setTextColor(120, 120, 120);
        doc.text(
          "Cambridge grade bands: A* 90-100 \u00B7 A 80-89 \u00B7 B 70-79 \u00B7 C 60-69 \u00B7 D 50-59 \u00B7 E 40-49 \u00B7 F 30-39 \u00B7 G 20-29 \u00B7 U below 20",
          14,
          pageHeight - 12
        );
        doc.text("Forest Park Academy \u2014 FPA Analytics", pageWidth - 14, pageHeight - 12, { align: "right" });
      }

      doc.save(`${examName.replace(/\s+/g, "_")}_results.pdf`);
    } catch (err) {
      // Keep the real error in the console for debugging, but show a
      // friendlier banner - and call out the most common actual cause
      // (the packages not being installed yet) instead of a generic message.
      console.error("PDF generation failed:", err);
      const missingPackage =
        /Failed to resolve module|Cannot find module|Failed to fetch dynamically imported module/i.test(err?.message || "");
      setLoadError(
        missingPackage
          ? 'Could not generate the PDF: the "jspdf" and "jspdf-autotable" packages aren\'t installed. Run `npm install jspdf jspdf-autotable` in the project, then try again.'
          : "Could not generate the PDF. Please try again."
      );
    } finally {
      setDownloadingKey(null);
    }
  }

  if (loading) return <p style={{ color: "var(--fp-ink-soft)" }}>Loading your results…</p>;

  if (loadError) {
    return (
      <section>
        <h2 style={{ marginBottom: 4 }}>My results</h2>
        <LoadErrorBanner message={loadError} onRetry={load} />
      </section>
    );
  }

  if (examGroups.length === 0) {
    return (
      <section>
        <h2 style={{ marginBottom: 4 }}>My results</h2>
        <div className="fp-card fp-empty" style={{ marginTop: 16 }}>
          No results have been published yet. Check back once your teachers submit them and your admin publishes them.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 style={{ marginBottom: 4 }}>My results</h2>
      <p style={{ color: "var(--fp-ink-soft)", fontSize: "0.92rem", marginBottom: 20 }}>
        Published marks and teacher comments, grouped by examination. These are read-only.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {examGroups.map((exam) => {
          const key = exam.examName + exam.term;
          return (
            <div key={key} className="fp-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontWeight: 600, fontFamily: "var(--fp-font-display)" }}>{exam.examName}</div>
                  <span className="fp-badge fp-badge-gold">{exam.term}</span>
                </div>
                <button
                  className="fp-btn"
                  disabled={downloadingKey === key}
                  onClick={() => downloadPdf(key, exam.examName, exam.term, exam.subjects, exam.studentName)}
                >
                  <Download size={14} /> {downloadingKey === key ? "Preparing…" : "Download PDF"}
                </button>
              </div>
              {exam.subjects?.length ? (
                <table className="fp-table">
                  <thead><tr><th>Subject</th><th style={{ width: 110 }}>Score</th><th>Teacher comment</th></tr></thead>
                  <tbody>
                    {exam.subjects.map((subj) => (
                      <tr key={subj.subject}>
                        <td>{subj.subject}</td>
                        <td>
                          <strong>{subj.score}%</strong>
                          <GradeBadge score={subj.score} />
                        </td>
                        <td style={{ color: "var(--fp-ink-soft)" }}>{subj.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ color: "var(--fp-ink-soft)", fontSize: "0.88rem" }}>No subject scores recorded for this exam yet.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// GET /api/student/results returns a flat list of marks (one row per
// subject per exam - see student_list_results in the backend). Group it
// into { examName, term, subjects: [{ subject, score, comment }] } so it
// matches the exam-card layout above.
function groupByExam(flatResults) {
  const byExam = new Map();
  for (const row of flatResults) {
    const key = `${row.examName}__${row.term}`;
    if (!byExam.has(key)) {
      byExam.set(key, { examName: row.examName, term: row.term, studentName: row.studentName, subjects: [] });
    }
    byExam.get(key).subjects.push({ subject: row.subject, score: row.score, comment: row.comment });
  }
  return [...byExam.values()];
}

// GET /api/student/results/trends returns a flat list of
// { term, subject, averageScore } (one row per term+subject - see
// student_get_trends in the backend). Recharts needs one row per x-axis
// point (term) with each subject as its own column, e.g.
// { examName: "Term 1", Mathematics: 68, Biology: 74 } - this pivots the
// flat backend shape into that.
function pivotTrends(flatRows) {
  const byTerm = new Map();
  const subjectNames = new Set();
  for (const row of flatRows) {
    if (!byTerm.has(row.term)) byTerm.set(row.term, { examName: row.term });
    byTerm.get(row.term)[row.subject] = row.averageScore;
    subjectNames.add(row.subject);
  }
  return { rows: [...byTerm.values()], subjectNames: [...subjectNames].sort() };
}

// -----------------------------------------------------------------------------
// TRENDS PANEL: a time-series line chart, one line per subject, plotting
// average score across every published exam sitting - so a student can
// compare how they're trending in one subject against their own past
// performance, and against their other subjects side by side.
// -----------------------------------------------------------------------------
function TrendsPanel() {
  const [trendData, setTrendData] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await studentGetTrends(); // GET /api/student/results/trends
      const raw = Array.isArray(res.data) ? res.data : [];
      const { rows, subjectNames } = pivotTrends(raw);
      setTrendData(rows);
      setSubjects(subjectNames);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load your trends. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p style={{ color: "var(--fp-ink-soft)" }}>Loading your trends…</p>;

  return (
    <section>
      <h2 style={{ marginBottom: 4 }}>Trends</h2>
      <p style={{ color: "var(--fp-ink-soft)", fontSize: "0.92rem", marginBottom: 20 }}>
        Your average score per subject across every published exam - compare a subject's own trend, or one subject against another.
      </p>

      {loadError ? (
        <LoadErrorBanner message={loadError} onRetry={load} />
      ) : trendData.length === 0 ? (
        <div className="fp-card fp-empty">Not enough published results yet to plot a trend.</div>
      ) : (
        <div className="fp-card" style={{ height: 380 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--fp-line)" />
              <XAxis dataKey="examName" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              {subjects.map((subject, i) => (
                <Line
                  key={subject}
                  type="monotone"
                  dataKey={subject}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
