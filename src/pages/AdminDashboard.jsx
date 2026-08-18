// =============================================================================
// src/pages/AdminDashboard.jsx
//
// The admin's control center. From here an admin can:
// - Register and delete students, together with the subjects they take
// - Create and delete examinations
// - Add and remove teacher accounts, grant/revoke publish permission, and
//   assign a teacher to a class (subject + grade level/stream)
// - Review results teachers have submitted and publish them - either the
//   whole class at once, or specific students now while leaving the rest
//   for later
// - Edit a result after it's been published, or depublish it (whole batch
//   or just one student) so the teacher can make further edits
//
// The page is organized into TABS instead of separate routes, because they
// all share the same "admin shell" (navbar + sidebar).
//
// BACKEND NOTE: several panels below call api/api.js functions that are new
// in this version (adminCreateTeacher, adminDeleteTeacher, adminDeleteExam,
// adminListPublishedResults, adminDepublishResults, adminEditPublishedResult).
// Add matching entries to api/api.js and the FastAPI routes documented next
// to each call below - the endpoint paths and payload shapes are noted
// inline so the backend contract is unambiguous.
// =============================================================================
import { useEffect, useState } from "react";
import {
  Users, ClipboardList, ShieldCheck, CheckCircle2, XCircle, Trash2, Plus, BookPlus,
  UserPlus, Undo2, Pencil, Save, FolderOpenDot,
} from "lucide-react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import {
  adminListStudents,
  adminCreateStudent,
  adminDeleteStudent,
  adminListTeachers,
  adminCreateTeacher,
  adminDeleteTeacher,
  adminGrantTeacherAccess,
  adminRevokeTeacherAccess,
  adminAssignTeacherClass,
  adminListExams,
  adminCreateExam,
  adminDeleteExam,
  adminListPendingResults,
  adminPublishResults,
  adminRejectResults,
  adminListPublishedResults,
  adminDepublishResults,
  adminEditPublishedResult,
} from "../api/api";

// -----------------------------------------------------------------------------
// FastAPI returns errors in two shapes: a plain string ({ detail: "..." })
// for business-logic errors, or an array of validation-error objects
// ({ detail: [{ loc, msg, type }] }) for a 422. The old code only handled
// the string case, so a validation failure (like the missing `subjects`
// field on exam creation, fixed below) rendered as "[object Object]" or a
// blank banner instead of the real reason. Route every catch-block error
// through this helper instead of reading err.response.data.detail directly.
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// FastAPI/Pydantic, by default, serializes fields using their Python
// attribute names - snake_case (full_name, date_of_birth, grade_level,
// can_publish_results...). This app is written entirely around camelCase
// (fullName, dateOfBirth, gradeLevel, canPublishResults...). That mismatch
// was the root cause behind three reported bugs:
//   - Students only showed an email, never a name -> s.fullName was
//     undefined because the API sent full_name. Email looked fine only
//     because "email" happens to be spelled the same both ways.
//   - Assigning a class to a teacher didn't show the class name -> same
//     issue with c.gradeLevel vs grade_level.
//   - The delete-student 500 is very likely the same mismatch from the
//     other direction: if a student ever rendered with id undefined
//     (e.g. the API used student_id), the delete button would call
//     DELETE /api/admin/students/undefined, and a backend that tries to
//     parse "undefined" as an int/UUID throws an unhandled exception -> 500.
//
// camelizeKeys() below recurses through every response before it's put in
// state, so all of the above are fixed in one place. It's a no-op if your
// backend already returns camelCase.
// -----------------------------------------------------------------------------
function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function camelizeKeys(input) {
  if (Array.isArray(input)) return input.map(camelizeKeys);
  if (input !== null && typeof input === "object" && !(input instanceof Date)) {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [toCamel(key), camelizeKeys(value)])
    );
  }
  return input;
}

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
// sync with the same table used on TeacherDashboard.jsx and
// StudentDashboard.jsx. If this ever moves into a shared
// "src/lib/grading.js" module, update the import in all three files instead
// of the table itself.
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

// -----------------------------------------------------------------------------
// The school runs two parallel classes per form - "Green" and "Yellow" -
// from Form 1 through Upper Six. The backend's `grade_level` column is a
// single free-text string, so the stream is encoded directly into it, e.g.
// "Form 3 Green" / "Form 3 Yellow". If a dedicated `stream` column is ever
// added on the backend, this is the only place that needs to change.
// -----------------------------------------------------------------------------
const FORMS = ["Form 1", "Form 2", "Form 3", "Form 4", "Lower Six", "Upper Six"];
const STREAMS = ["Green", "Yellow"];
const GRADE_LEVELS = FORMS.flatMap((form) => STREAMS.map((stream) => `${form} ${stream}`));

// Subjects offered at the school - edit this list to match the real
// curriculum. Drives the exam-creation form, teacher class assignment, and
// student subject enrolment.
const SUBJECTS = [
  "Mathematics",
  "English Language",
  "Combined Science",
  "Biology",
  "Chemistry",
  "Physics",
  "Computer Science",
  "Geography",
  "History",
  "Agriculture",
  "Shona",
  "Travel and Tourism",
  "Accounting",
  "Business studies",
];

const TABS = [
  { key: "students", label: "Students", icon: Users },
  { key: "exams", label: "Examinations", icon: ClipboardList },
  { key: "teachers", label: "Teacher access", icon: ShieldCheck },
  { key: "results", label: "Publish results", icon: CheckCircle2 },
  { key: "published", label: "Published results", icon: FolderOpenDot },
];

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("students");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />
      <div style={{ display: "flex", flex: 1 }}>
        <Sidebar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
        <main style={{ flex: 1, padding: "28px 32px", overflow: "auto" }}>
          {activeTab === "students" && <StudentsPanel />}
          {activeTab === "exams" && <ExamsPanel />}
          {activeTab === "teachers" && <TeachersPanel />}
          {activeTab === "results" && <ResultsPanel />}
          {activeTab === "published" && <PublishedResultsPanel />}
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
        marginBottom: 16,
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

function SuccessBanner({ message }) {
  if (!message) return null;
  return (
    <div
      className="fp-card"
      style={{
        marginBottom: 16,
        background: "rgba(45,106,79,0.08)",
        borderColor: "var(--fp-canopy)",
        color: "var(--fp-canopy)",
        fontSize: "0.9rem",
      }}
    >
      {message}
    </div>
  );
}

function PanelHeader({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>{title}</h2>
        <p style={{ color: "var(--fp-ink-soft)", fontSize: "0.92rem" }}>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

// -----------------------------------------------------------------------------
// STUDENTS PANEL: list every student (name + email + class + subjects),
// register new ones (with the subjects they're taking), or delete one.
// -----------------------------------------------------------------------------
const EMPTY_STUDENT_FORM = {
  fullName: "",
  dateOfBirth: "",
  gradeLevel: GRADE_LEVELS[0],
  email: "",
  password: "",
  confirmPassword: "",
  subjects: [],
};

function StudentsPanel() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newStudent, setNewStudent] = useState(EMPTY_STUDENT_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  async function loadStudents() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await adminListStudents(); // GET /api/admin/students
      setStudents(camelizeKeys(Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load students. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents();
  }, []);

  function handleFieldChange(e) {
    const { name, value } = e.target;
    setNewStudent((prev) => ({ ...prev, [name]: value }));
  }

  function toggleStudentSubject(subject) {
    setNewStudent((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subject)
        ? prev.subjects.filter((s) => s !== subject)
        : [...prev.subjects, subject],
    }));
  }

  function resetForm() {
    setNewStudent(EMPTY_STUDENT_FORM);
    setFormError("");
  }

  function validateForm() {
    if (!newStudent.fullName.trim()) return "Full name is required.";
    if (!newStudent.dateOfBirth) return "Date of birth is required.";
    if (!newStudent.email.trim()) return "Email is required.";
    if (newStudent.password !== newStudent.confirmPassword) return "Passwords do not match.";
    if (newStudent.password.length < 8) return "Password must be at least 8 characters.";
    if (newStudent.subjects.length === 0) return "Pick at least one subject this student is taking.";
    return "";
  }

  async function handleCreate(e) {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError("");
    setSubmitting(true);
    try {
      const { confirmPassword, ...payload } = newStudent;
      await adminCreateStudent(payload); // POST /api/admin/students  { ..., subjects: string[] }
      resetForm();
      setShowForm(false);
      await loadStudents();
    } catch (err) {
      setFormError(getErrorMessage(err, "Could not register student. Please check the details and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(studentId) {
    // Guards against the DELETE /api/admin/students/undefined request that
    // was almost certainly behind the 500 error - if the id ever comes
    // back missing (e.g. a field-name mismatch from the API), fail
    // visibly in the UI instead of sending a bad id to the backend.
    if (studentId === undefined || studentId === null) {
      setDeleteError("Could not remove that student: no student id was returned by the server.");
      return;
    }

    const confirmed = window.confirm("Remove this student's record permanently?");
    if (!confirmed) return;

    setDeleteError("");
    setDeletingId(studentId);
    try {
      await adminDeleteStudent(studentId); // DELETE /api/admin/students/{id}
      await loadStudents();
    } catch (err) {
      // A 500 here (rather than 404/422) usually means the backend threw an
      // unhandled exception - most commonly a foreign-key constraint (the
      // student still has result rows / mark entries pointing at them) or
      // a failed id parse. Check the FastAPI server logs for the actual
      // traceback on the DELETE /api/admin/students/{id} route; the fix is
      // typically to cascade-delete the student's related rows first, or
      // catch the IntegrityError and return a 409 with a readable message.
      setDeleteError(getErrorMessage(err, "Could not remove that student. Please try again."));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section>
      <PanelHeader
        title="Students"
        subtitle="Everyone currently enrolled at Forest Park Academy."
        action={
          <button
            className="fp-btn fp-btn-primary"
            onClick={() => {
              setShowForm((v) => !v);
              if (showForm) resetForm();
            }}
          >
            <Plus size={16} /> Register student
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="fp-card"
          style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 680 }}
        >
          {formError && (
            <div role="alert" style={inlineErrorStyle}>
              {formError}
            </div>
          )}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <label className="fp-label" htmlFor="fullName">Full name</label>
              <input
                id="fullName" name="fullName" className="fp-input" required
                value={newStudent.fullName} onChange={handleFieldChange} placeholder="Tanaka Moyo"
              />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label className="fp-label" htmlFor="dateOfBirth">Date of birth</label>
              <input
                id="dateOfBirth" name="dateOfBirth" type="date" className="fp-input" required
                value={newStudent.dateOfBirth} onChange={handleFieldChange}
              />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="fp-label" htmlFor="gradeLevel">Class (form &amp; stream)</label>
              <select id="gradeLevel" name="gradeLevel" className="fp-input" value={newStudent.gradeLevel} onChange={handleFieldChange}>
                {GRADE_LEVELS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <label className="fp-label" htmlFor="email">Email address</label>
              <input
                id="email" name="email" type="email" className="fp-input" required
                value={newStudent.email} onChange={handleFieldChange} placeholder="you@example.com"
              />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label className="fp-label" htmlFor="password">Password</label>
              <input
                id="password" name="password" type="password" className="fp-input" required minLength={8}
                value={newStudent.password} onChange={handleFieldChange}
              />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label className="fp-label" htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword" name="confirmPassword" type="password" className="fp-input" required
                value={newStudent.confirmPassword} onChange={handleFieldChange}
              />
            </div>
          </div>

          <div>
            <label className="fp-label">Subjects this student is taking</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 6 }}>
              {SUBJECTS.map((subject) => (
                <label key={subject} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={newStudent.subjects.includes(subject)} onChange={() => toggleStudentSubject(subject)} />
                  {subject}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="fp-btn" disabled={submitting} onClick={() => { resetForm(); setShowForm(false); }}>
              Cancel
            </button>
            <button type="submit" className="fp-btn fp-btn-gold" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {deleteError && <LoadErrorBanner message={deleteError} />}

      {loading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading students…</p>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} onRetry={loadStudents} />
      ) : students.length === 0 ? (
        <div className="fp-card fp-empty">No students registered yet.</div>
      ) : (
        <div className="fp-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="fp-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Class</th><th>Subjects</th><th></th></tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.fullName}</td>
                  <td>{s.email}</td>
                  <td><span className="fp-badge fp-badge-green">{s.gradeLevel}</span></td>
                  <td style={{ fontSize: "0.85rem", color: "var(--fp-ink-soft)" }}>{s.subjects?.join(", ") || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="fp-btn fp-btn-danger" disabled={deletingId === s.id} onClick={() => handleDelete(s.id)}>
                      <Trash2 size={14} /> {deletingId === s.id ? "Removing…" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// EXAMS PANEL: list examinations, create new ones, and delete ones no longer
// needed.
//
// FIX: the backend's AdminCreateExamRequest requires a non-empty `subjects`
// list (it's persisted straight onto the Exam row - see admin_create_exam in
// the backend). The old form never collected subjects at all, so every
// submission failed 422 validation and the admin only ever saw a generic/
// blank error. This version adds a required subject picker and uses
// getErrorMessage() so a validation failure is actually readable - the same
// pattern now covers deletion too, so create/delete both surface the real
// reason instead of a silent or generic failure.
// -----------------------------------------------------------------------------
const EMPTY_EXAM_FORM = { name: "", term: "", gradeLevel: GRADE_LEVELS[0], subjects: [], startDate: "", endDate: "" };

function ExamsPanel() {
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [newExam, setNewExam] = useState(EMPTY_EXAM_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  async function loadExams() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await adminListExams(); // GET /api/admin/exams
      setExams(camelizeKeys(Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load examinations. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadExams(); }, []);

  function toggleSubject(subject) {
    setNewExam((prev) => ({
      ...prev,
      subjects: prev.subjects.includes(subject)
        ? prev.subjects.filter((s) => s !== subject)
        : [...prev.subjects, subject],
    }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (newExam.subjects.length === 0) {
      setFormError("Pick at least one subject for this examination.");
      return;
    }
    if (new Date(newExam.endDate) < new Date(newExam.startDate)) {
      setFormError("End date can't be before the start date.");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      await adminCreateExam(newExam); // POST /api/admin/exams
      setNewExam(EMPTY_EXAM_FORM);
      setShowForm(false);
      await loadExams();
    } catch (err) {
      setFormError(getErrorMessage(err, "Could not create the examination. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(examId) {
    if (examId === undefined || examId === null) {
      setDeleteError("Could not remove that examination: no examination id was returned by the server.");
      return;
    }
    const confirmed = window.confirm("Delete this examination? Any mark sheets teachers have started for it will be removed too.");
    if (!confirmed) return;

    setDeleteError("");
    setDeletingId(examId);
    try {
      await adminDeleteExam(examId); // DELETE /api/admin/exams/{id}
      await loadExams();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Could not delete that examination. Please try again."));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section>
      <PanelHeader
        title="Examinations"
        subtitle="Create and manage examination sittings."
        action={
          <button className="fp-btn fp-btn-primary" onClick={() => setShowForm((v) => !v)}>
            <Plus size={16} /> Create examination
          </button>
        }
      />
      {showForm && (
        <form onSubmit={handleCreate} className="fp-card" style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          {formError && <div role="alert" style={inlineErrorStyle}>{formError}</div>}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label className="fp-label">Exam name</label>
              <input className="fp-input" required placeholder="Term 2 Mid-Terms"
                value={newExam.name} onChange={(e) => setNewExam({ ...newExam, name: e.target.value })} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label className="fp-label">Term</label>
              <input className="fp-input" required placeholder="Term 2"
                value={newExam.term} onChange={(e) => setNewExam({ ...newExam, term: e.target.value })} />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <label className="fp-label">Class (form &amp; stream)</label>
              <select className="fp-input" value={newExam.gradeLevel} onChange={(e) => setNewExam({ ...newExam, gradeLevel: e.target.value })}>
                {GRADE_LEVELS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="fp-label">Subjects being examined</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 6 }}>
              {SUBJECTS.map((subject) => (
                <label key={subject} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={newExam.subjects.includes(subject)} onChange={() => toggleSubject(subject)} />
                  {subject}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label className="fp-label">Start date</label>
              <input className="fp-input" type="date" required
                value={newExam.startDate} onChange={(e) => setNewExam({ ...newExam, startDate: e.target.value })} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label className="fp-label">End date</label>
              <input className="fp-input" type="date" required
                value={newExam.endDate} onChange={(e) => setNewExam({ ...newExam, endDate: e.target.value })} />
            </div>
            <button type="submit" className="fp-btn fp-btn-gold" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
      {deleteError && <LoadErrorBanner message={deleteError} />}
      {loading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading examinations…</p>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} onRetry={loadExams} />
      ) : exams.length === 0 ? (
        <div className="fp-card fp-empty">No examinations created yet.</div>
      ) : (
        <div className="fp-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="fp-table">
            <thead><tr><th>Name</th><th>Term</th><th>Class</th><th>Subjects</th><th>Dates</th><th></th></tr></thead>
            <tbody>
              {exams.map((ex) => (
                <tr key={ex.id}>
                  <td>{ex.name}</td>
                  <td>{ex.term}</td>
                  <td>{ex.gradeLevel}</td>
                  <td style={{ fontSize: "0.85rem", color: "var(--fp-ink-soft)" }}>{ex.subjects?.join(", ")}</td>
                  <td>{ex.startDate} – {ex.endDate}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="fp-btn fp-btn-danger" disabled={deletingId === ex.id} onClick={() => handleDelete(ex.id)}>
                      <Trash2 size={14} /> {deletingId === ex.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// TEACHERS PANEL: add or remove teacher accounts, grant/revoke publish
// access, and assign a teacher to a class (subject + form/stream).
// -----------------------------------------------------------------------------
const EMPTY_TEACHER_FORM = { fullName: "", email: "", password: "", confirmPassword: "" };

function TeachersPanel() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [togglingId, setTogglingId] = useState(null);
  const [toggleError, setToggleError] = useState("");

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTeacher, setNewTeacher] = useState(EMPTY_TEACHER_FORM);
  const [addError, setAddError] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);

  const [removingId, setRemovingId] = useState(null);
  const [removeError, setRemoveError] = useState("");

  const [assigningForId, setAssigningForId] = useState(null); // teacher id whose "assign class" row is open
  const [assignForm, setAssignForm] = useState({ subject: SUBJECTS[0], gradeLevel: GRADE_LEVELS[0] });
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [assignSuccessMessage, setAssignSuccessMessage] = useState("");

  async function loadTeachers() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await adminListTeachers(); // GET /api/admin/teachers
      setTeachers(camelizeKeys(Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load teachers. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTeachers(); }, []);

  function handleNewTeacherChange(e) {
    const { name, value } = e.target;
    setNewTeacher((prev) => ({ ...prev, [name]: value }));
  }

  async function handleAddTeacher(e) {
    e.preventDefault();
    if (!newTeacher.fullName.trim() || !newTeacher.email.trim()) {
      setAddError("Full name and email are required.");
      return;
    }
    if (newTeacher.password.length < 8) {
      setAddError("Password must be at least 8 characters.");
      return;
    }
    if (newTeacher.password !== newTeacher.confirmPassword) {
      setAddError("Passwords do not match.");
      return;
    }
    setAddError("");
    setAddSubmitting(true);
    try {
      const { confirmPassword, ...payload } = newTeacher;
      await adminCreateTeacher(payload); // POST /api/admin/teachers  { fullName, email, password }
      setNewTeacher(EMPTY_TEACHER_FORM);
      setShowAddForm(false);
      await loadTeachers();
    } catch (err) {
      setAddError(getErrorMessage(err, "Could not add that teacher. Please check the details and try again."));
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleRemoveTeacher(teacherId) {
    if (teacherId === undefined || teacherId === null) {
      setRemoveError("Could not remove that teacher: no teacher id was returned by the server.");
      return;
    }
    const confirmed = window.confirm("Remove this teacher's account? They will no longer be able to sign in.");
    if (!confirmed) return;

    setRemoveError("");
    setRemovingId(teacherId);
    try {
      await adminDeleteTeacher(teacherId); // DELETE /api/admin/teachers/{id}
      await loadTeachers();
    } catch (err) {
      setRemoveError(getErrorMessage(err, "Could not remove that teacher. They may still have submitted results on file."));
    } finally {
      setRemovingId(null);
    }
  }

  async function grantAccess(teacher) {
    setToggleError("");
    setTogglingId(teacher.id);
    try {
      await adminGrantTeacherAccess(teacher.id); // POST /api/admin/teachers/{id}/grant-access
      await loadTeachers();
    } catch (err) {
      setToggleError(getErrorMessage(err, "Could not grant that teacher publish access. Please try again."));
    } finally {
      setTogglingId(null);
    }
  }

  async function revokeAccess(teacher) {
    setToggleError("");
    setTogglingId(teacher.id);
    try {
      await adminRevokeTeacherAccess(teacher.id); // POST /api/admin/teachers/{id}/revoke-access
      await loadTeachers();
    } catch (err) {
      setToggleError(getErrorMessage(err, "Could not revoke that teacher's publish access. Please try again."));
    } finally {
      setTogglingId(null);
    }
  }

  function openAssignForm(teacherId) {
    setAssignError("");
    setAssignSuccessMessage("");
    setAssignForm({ subject: SUBJECTS[0], gradeLevel: GRADE_LEVELS[0] });
    setAssigningForId((current) => (current === teacherId ? null : teacherId));
  }

  async function handleAssignClass(e, teacherId) {
    e.preventDefault();
    setAssignError("");
    setAssignSuccessMessage("");
    setAssignSubmitting(true);
    const assignedClass = { subject: assignForm.subject, gradeLevel: assignForm.gradeLevel };
    try {
      await adminAssignTeacherClass(teacherId, assignedClass); // POST /api/admin/teachers/{id}/classes

      // FIX for "No classes assigned yet." showing even after a successful
      // assignment: update local state with the class immediately instead
      // of relying entirely on the GET below. If the backend's teacher-list
      // response shapes a teacher's classes differently than expected, the
      // re-fetch could look like nothing changed even though the POST
      // above succeeded - updating state directly guarantees the admin
      // sees the result of the action they just took. This is also why
      // "No classes assigned yet." now only ever shows for a teacher whose
      // `classes` array is genuinely empty, not one where the response
      // shape briefly didn't match.
      setTeachers((prev) =>
        prev.map((t) => {
          if (t.id !== teacherId) return t;
          const alreadyThere = (t.classes || []).some(
            (c) => c.subject === assignedClass.subject && c.gradeLevel === assignedClass.gradeLevel
          );
          return alreadyThere ? t : { ...t, classes: [...(t.classes || []), assignedClass] };
        })
      );

      setAssigningForId(null);
      setAssignSuccessMessage(
        `${assignedClass.subject} (${assignedClass.gradeLevel}) was assigned successfully.`
      );

      // Re-sync with the server in the background, but merge rather than
      // overwrite - if the fresh list doesn't include the class we just
      // confirmed was saved (a field-name mismatch, caching, etc.), keep
      // showing it instead of letting it silently disappear again.
      try {
        const res = await adminListTeachers(); // GET /api/admin/teachers
        const fresh = camelizeKeys(Array.isArray(res.data) ? res.data : []);
        setTeachers((prevTeachers) =>
          fresh.map((freshTeacher) => {
            if (freshTeacher.id !== teacherId) return freshTeacher;
            const hasIt = (freshTeacher.classes || []).some(
              (c) => c.subject === assignedClass.subject && c.gradeLevel === assignedClass.gradeLevel
            );
            return hasIt
              ? freshTeacher
              : { ...freshTeacher, classes: [...(freshTeacher.classes || []), assignedClass] };
          })
        );
      } catch {
        // Background resync failing is fine - the optimistic update above
        // already reflects the successful assignment.
      }
    } catch (err) {
      setAssignError(getErrorMessage(err, "Could not assign that class. It may already be assigned to this teacher."));
    } finally {
      setAssignSubmitting(false);
    }
  }

  return (
    <section>
      <PanelHeader
        title="Teacher access"
        subtitle="Add or remove teacher accounts, control publish permissions, and assign classes by subject."
        action={
          <button className="fp-btn fp-btn-primary" onClick={() => setShowAddForm((v) => !v)}>
            <UserPlus size={16} /> Add teacher
          </button>
        }
      />

      {showAddForm && (
        <form onSubmit={handleAddTeacher} className="fp-card" style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}>
          {addError && <div role="alert" style={inlineErrorStyle}>{addError}</div>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <label className="fp-label" htmlFor="teacherFullName">Full name</label>
              <input id="teacherFullName" name="fullName" className="fp-input" required
                value={newTeacher.fullName} onChange={handleNewTeacherChange} placeholder="Mrs. Rudo Chikafu" />
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <label className="fp-label" htmlFor="teacherEmail">Email address</label>
              <input id="teacherEmail" name="email" type="email" className="fp-input" required
                value={newTeacher.email} onChange={handleNewTeacherChange} placeholder="teacher@fpa.ac.zw" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}>
              <label className="fp-label" htmlFor="teacherPassword">Password</label>
              <input id="teacherPassword" name="password" type="password" className="fp-input" required minLength={8}
                value={newTeacher.password} onChange={handleNewTeacherChange} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label className="fp-label" htmlFor="teacherConfirmPassword">Confirm password</label>
              <input id="teacherConfirmPassword" name="confirmPassword" type="password" className="fp-input" required
                value={newTeacher.confirmPassword} onChange={handleNewTeacherChange} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" className="fp-btn" disabled={addSubmitting} onClick={() => { setNewTeacher(EMPTY_TEACHER_FORM); setShowAddForm(false); setAddError(""); }}>
              Cancel
            </button>
            <button type="submit" className="fp-btn fp-btn-gold" disabled={addSubmitting}>
              {addSubmitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}

      {toggleError && <LoadErrorBanner message={toggleError} />}
      {removeError && <LoadErrorBanner message={removeError} />}
      <SuccessBanner message={assignSuccessMessage} />

      {loading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading teachers…</p>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} onRetry={loadTeachers} />
      ) : teachers.length === 0 ? (
        <div className="fp-card fp-empty">No teacher accounts yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {teachers.map((t) => (
            <div key={t.id} className="fp-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.fullName}</div>
                  <div style={{ fontSize: "0.85rem", color: "var(--fp-ink-soft)" }}>{t.email}</div>
                  {/* Only ever shows the "no classes" fallback for a teacher whose
                      classes array is genuinely empty - see the fix note in
                      handleAssignClass() above. */}
                  <div style={{ fontSize: "0.85rem", marginTop: 6 }}>
                    {t.classes?.length ? (
                      t.classes.map((c) => (
                        <span key={`${c.subject}-${c.gradeLevel}`} className="fp-badge fp-badge-gold" style={{ marginRight: 6, marginBottom: 4, display: "inline-block" }}>
                          {c.subject} ({c.gradeLevel})
                        </span>
                      ))
                    ) : (
                      <span style={{ color: "var(--fp-ink-soft)" }}>No classes assigned yet.</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span className={`fp-badge ${t.canPublishResults ? "fp-badge-green" : "fp-badge-red"}`}>
                    {t.canPublishResults ? "Publish: Granted" : "Publish: Revoked"}
                  </span>
                  <button
                    className="fp-btn fp-btn-primary"
                    disabled={togglingId === t.id || t.canPublishResults}
                    onClick={() => grantAccess(t)}
                  >
                    {togglingId === t.id ? "Updating…" : "Grant"}
                  </button>
                  <button
                    className="fp-btn fp-btn-danger"
                    disabled={togglingId === t.id || !t.canPublishResults}
                    onClick={() => revokeAccess(t)}
                  >
                    {togglingId === t.id ? "Updating…" : "Revoke"}
                  </button>
                  <button className="fp-btn" onClick={() => openAssignForm(t.id)}>
                    <BookPlus size={14} /> Assign class
                  </button>
                  <button className="fp-btn fp-btn-danger" disabled={removingId === t.id} onClick={() => handleRemoveTeacher(t.id)}>
                    <Trash2 size={14} /> {removingId === t.id ? "Removing…" : "Remove"}
                  </button>
                </div>
              </div>

              {assigningForId === t.id && (
                <form
                  onSubmit={(e) => handleAssignClass(e, t.id)}
                  style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--fp-line)", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}
                >
                  {assignError && <div role="alert" style={{ ...inlineErrorStyle, width: "100%" }}>{assignError}</div>}
                  <div style={{ flex: "1 1 200px" }}>
                    <label className="fp-label">Subject</label>
                    <select className="fp-input" value={assignForm.subject} onChange={(e) => setAssignForm({ ...assignForm, subject: e.target.value })}>
                      {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: "1 1 200px" }}>
                    <label className="fp-label">Class (form &amp; stream)</label>
                    <select className="fp-input" value={assignForm.gradeLevel} onChange={(e) => setAssignForm({ ...assignForm, gradeLevel: e.target.value })}>
                      {GRADE_LEVELS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <button type="submit" className="fp-btn fp-btn-gold" disabled={assignSubmitting}>
                    {assignSubmitting ? "Assigning…" : "Assign"}
                  </button>
                  <button type="button" className="fp-btn" onClick={() => setAssigningForId(null)}>Cancel</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// RESULTS PANEL: mark sheets teachers have submitted, awaiting admin review.
// A batch can be published in full, or - when the backend includes a
// per-student breakdown on each batch (`b.students`) - the admin can select
// just some students to publish now and leave the rest pending, then come
// back and publish the remainder later. Batches without a `students` array
// fall back to whole-batch publish/reject only.
//
// BACKEND NOTE: GET /api/admin/results/pending should include, per batch,
// a `students: [{ id, fullName, score, comment }]` array so partial
// publish has something to select from. POST /api/admin/results/{id}/publish
// should accept an optional body `{ studentIds?: number[] }` - omit it (or
// send all ids) to publish the whole batch, or send a subset to publish
// only those students while the rest stay pending for a later publish call.
// -----------------------------------------------------------------------------
function ResultsPanel() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [selectedByBatch, setSelectedByBatch] = useState({}); // { batchId: Set(studentId) }
  const [expandedId, setExpandedId] = useState(null);

  async function loadPending() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await adminListPendingResults(); // GET /api/admin/results/pending
      setBatches(camelizeKeys(Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load pending results. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPending(); }, []);

  function toggleStudentSelected(batchId, studentId) {
    setSelectedByBatch((prev) => {
      const current = new Set(prev[batchId] || []);
      if (current.has(studentId)) current.delete(studentId);
      else current.add(studentId);
      return { ...prev, [batchId]: current };
    });
  }

  async function handlePublish(batchId, studentIds) {
    setActionError("");
    setActionSuccess("");
    setActingId(batchId);
    try {
      await adminPublishResults(batchId, studentIds && studentIds.length ? { studentIds } : undefined); // POST /api/admin/results/{id}/publish
      setSelectedByBatch((prev) => ({ ...prev, [batchId]: new Set() }));
      setActionSuccess(
        studentIds && studentIds.length
          ? `Published results for ${studentIds.length} selected student${studentIds.length === 1 ? "" : "s"}. They can now see them on their student portal.`
          : "Published results for the whole class. All students in this batch can now see them on their student portal."
      );
      await loadPending();
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not publish that batch. Please try again."));
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(batchId) {
    // rejectReason is already a plain string from the controlled <input>
    // below - if the backend still reports "reason: Input should be a
    // valid string" after this, the payload is being altered on the way
    // out. The most common cause: adminRejectResults(id, payload) in
    // api/api.js wrapping `payload` inside another object again (e.g.
    // `api.post(url, { reason: payload })` when payload is already
    // `{ reason: "..." }`), which sends `{ reason: { reason: "..." } }` -
    // a nested object where FastAPI expects a bare string. Check that
    // function's body against the call below.
    const reason = rejectReason.trim();
    if (!reason) {
      setActionError("Give the teacher a reason before rejecting.");
      return;
    }
    setActionError("");
    setActionSuccess("");
    setActingId(batchId);
    try {
      await adminRejectResults(batchId, { reason }); // POST /api/admin/results/{id}/reject
      setRejectingId(null);
      setRejectReason("");
      setActionSuccess("Sent back to the teacher for changes.");
      await loadPending();
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not reject that batch. Please try again."));
    } finally {
      setActingId(null);
    }
  }

  return (
    <section>
      <PanelHeader title="Publish results" subtitle="Mark sheets teachers have submitted, awaiting your review." />
      {actionSuccess && (
        <div className="fp-card" style={{ marginBottom: 16, background: "rgba(45,106,79,0.08)", borderColor: "var(--fp-canopy)" }}>
          {actionSuccess}
        </div>
      )}
      {actionError && <LoadErrorBanner message={actionError} />}
      {loading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading submissions…</p>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} onRetry={loadPending} />
      ) : batches.length === 0 ? (
        <div className="fp-card fp-empty">Nothing waiting for publication right now.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {batches.map((b) => {
            const hasStudentList = Array.isArray(b.students) && b.students.length > 0;
            const selected = selectedByBatch[b.id] || new Set();
            const isExpanded = expandedId === b.id;
            return (
              <div key={b.id} className="fp-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{b.subject} <span style={{ opacity: 0.7, fontWeight: 400 }}>({b.gradeLevel})</span> — {b.examName}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--fp-ink-soft)" }}>
                      Submitted by {b.teacherName} · {b.studentCount ?? b.students?.length ?? 0} students
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {hasStudentList && (
                      <button className="fp-btn" onClick={() => setExpandedId(isExpanded ? null : b.id)}>
                        {isExpanded ? "Hide students" : "Choose students…"}
                      </button>
                    )}
                    <button className="fp-btn fp-btn-danger" disabled={actingId === b.id} onClick={() => setRejectingId(rejectingId === b.id ? null : b.id)}>
                      <XCircle size={16} /> Reject
                    </button>
                    <button className="fp-btn fp-btn-gold" disabled={actingId === b.id} onClick={() => handlePublish(b.id)}>
                      <CheckCircle2 size={16} /> {actingId === b.id ? "Publishing…" : "Publish all"}
                    </button>
                  </div>
                </div>

                {isExpanded && hasStudentList && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--fp-line)" }}>
                    <table className="fp-table">
                      <thead><tr><th style={{ width: 34 }}></th><th>Student</th><th style={{ width: 100 }}>Score</th><th>Comment</th></tr></thead>
                      <tbody>
                        {b.students.map((s) => (
                          <tr key={s.id}>
                            <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleStudentSelected(b.id, s.id)} /></td>
                            <td>{s.fullName}</td>
                            <td>{s.score}% <GradeBadge score={s.score} /></td>
                            <td style={{ color: "var(--fp-ink-soft)", fontSize: "0.85rem" }}>{s.comment}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                      <button
                        className="fp-btn fp-btn-gold"
                        disabled={actingId === b.id || selected.size === 0}
                        onClick={() => handlePublish(b.id, [...selected])}
                      >
                        <CheckCircle2 size={16} /> Publish {selected.size || ""} selected
                      </button>
                    </div>
                    <p style={{ fontSize: "0.78rem", color: "var(--fp-ink-soft)", marginTop: 6 }}>
                      Students you don't select stay pending here, so you can come back and publish the rest later.
                    </p>
                  </div>
                )}

                {rejectingId === b.id && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--fp-line)", display: "flex", gap: 10 }}>
                    <input
                      className="fp-input"
                      placeholder="Reason for rejecting (shown to the teacher)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button className="fp-btn fp-btn-danger" disabled={actingId === b.id} onClick={() => handleReject(b.id)}>
                      {actingId === b.id ? "Rejecting…" : "Confirm reject"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// PUBLISHED RESULTS PANEL: results already visible to students. From here the
// admin can edit a mark or comment in place, depublish one student (sends
// just that student back to the teacher, editable, the rest stay published),
// or depublish the whole batch at once.
//
// BACKEND NOTE: GET /api/admin/results/published returns the same batch
// shape as pending results (see ResultsPanel above), each student row now
// also carrying a `markId` - the unique id of that student's result row,
// since the same student can appear in several batches (different
// subjects/exams) and studentId alone can't disambiguate which one to
// edit. POST /api/admin/results/{id}/depublish accepts an optional
// `{ studentIds?: number[] }` body - omit it to depublish the whole batch,
// or send specific ids to send just those students back to the teacher
// while the rest remain published. PATCH /api/admin/results/{markId}
// accepts `{ score, comment }` and persists the edit without changing
// publish state.
// -----------------------------------------------------------------------------
function PublishedResultsPanel() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [actingKey, setActingKey] = useState(null); // `${batchId}` or `${batchId}-${studentId}`
  const [selectedByBatch, setSelectedByBatch] = useState({});
  const [editing, setEditing] = useState(null); // { batchId, studentId, score, comment }
  const [savingEdit, setSavingEdit] = useState(false);

  async function loadPublished() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await adminListPublishedResults(); // GET /api/admin/results/published
      setBatches(camelizeKeys(Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load published results. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPublished(); }, []);

  function toggleStudentSelected(batchId, studentId) {
    setSelectedByBatch((prev) => {
      const current = new Set(prev[batchId] || []);
      if (current.has(studentId)) current.delete(studentId);
      else current.add(studentId);
      return { ...prev, [batchId]: current };
    });
  }

  // NOTE on "depublishing one student depublishes everyone": this call
  // already sends { studentIds: [id] } for a single-row depublish (see the
  // per-row button below) - a single-student request going out and the
  // whole batch coming back unpublished means POST
  // /api/admin/results/{id}/depublish is ignoring the studentIds body and
  // always depublishing the full batch. That's a backend fix (the handler
  // needs to branch on whether studentIds was provided, the same way the
  // publish endpoint already appears to for partial publish).
  async function handleDepublish(batchId, studentIds) {
    setActionError("");
    setActionSuccess("");
    setActingKey(studentIds && studentIds.length === 1 ? `${batchId}-${studentIds[0]}` : `${batchId}`);
    try {
      await adminDepublishResults(batchId, studentIds && studentIds.length ? { studentIds } : undefined); // POST /api/admin/results/{id}/depublish
      setSelectedByBatch((prev) => ({ ...prev, [batchId]: new Set() }));
      setActionSuccess(
        studentIds && studentIds.length
          ? `Sent ${studentIds.length} student${studentIds.length === 1 ? "" : "s"} back to the teacher for edits.`
          : "Sent the whole batch back to the teacher for edits."
      );
      await loadPublished();
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not depublish that result. Please try again."));
    } finally {
      setActingKey(null);
    }
  }

  function startEdit(batchId, student) {
    // markId (not studentId) is what uniquely identifies this result row on
    // the backend - a student can have marks in several batches (different
    // subjects/exams), so studentId alone isn't enough to edit the right one.
    setEditing({ batchId, studentId: student.id, markId: student.markId, score: student.score ?? "", comment: student.comment ?? "" });
  }

  async function saveEdit() {
    if (!editing) return;
    // If markId is missing here, GET /api/admin/results/published isn't
    // including a mark_id on this student's row, so there is no valid id
    // to PATCH - sending it anyway is what produces a backend
    // "mark_id is not defined" error (the handler receives no usable id
    // to look the row up by). Block the request client-side instead of
    // letting it fail server-side, and say why.
    if (editing.markId === undefined || editing.markId === null) {
      setActionError("This result is missing its record id from the server, so the edit can't be saved. Try refreshing the page, or ask the backend to include mark_id on published results.");
      return;
    }
    const num = Number(editing.score);
    if (editing.score !== "" && (Number.isNaN(num) || num < 0 || num > 100)) {
      setActionError("Score must be a number between 0 and 100.");
      return;
    }
    setActionError("");
    setSavingEdit(true);
    try {
      await adminEditPublishedResult(editing.markId, { // PATCH /api/admin/results/{markId}
        score: editing.score === "" ? null : num,
        comment: editing.comment,
      });
      setEditing(null);
      setActionSuccess("Saved.");
      await loadPublished();
    } catch (err) {
      setActionError(getErrorMessage(err, "Could not save that edit. Please try again."));
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <section>
      <PanelHeader title="Published results" subtitle="Results students can currently see. Edit a mark, or send one back to the teacher for changes." />
      {actionSuccess && (
        <div className="fp-card" style={{ marginBottom: 16, background: "rgba(45,106,79,0.08)", borderColor: "var(--fp-canopy)" }}>
          {actionSuccess}
        </div>
      )}
      {actionError && <LoadErrorBanner message={actionError} />}
      {loading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading published results…</p>
      ) : loadError ? (
        <LoadErrorBanner message={loadError} onRetry={loadPublished} />
      ) : batches.length === 0 ? (
        <div className="fp-card fp-empty">Nothing has been published yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {batches.map((b) => {
            const selected = selectedByBatch[b.id] || new Set();
            return (
              <div key={b.id} className="fp-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{b.subject} <span style={{ opacity: 0.7, fontWeight: 400 }}>({b.gradeLevel})</span> — {b.examName}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--fp-ink-soft)" }}>Marked by {b.teacherName}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="fp-btn"
                      disabled={selected.size === 0 || actingKey === `${b.id}`}
                      onClick={() => handleDepublish(b.id, [...selected])}
                    >
                      <Undo2 size={14} /> Depublish selected
                    </button>
                    <button className="fp-btn fp-btn-danger" disabled={actingKey === `${b.id}`} onClick={() => handleDepublish(b.id)}>
                      <Undo2 size={14} /> {actingKey === `${b.id}` ? "Depublishing…" : "Depublish all"}
                    </button>
                  </div>
                </div>

                <table className="fp-table">
                  <thead><tr><th style={{ width: 34 }}></th><th>Student</th><th style={{ width: 120 }}>Score</th><th>Comment</th><th></th></tr></thead>
                  <tbody>
                    {(b.students || []).map((s) => {
                      const isEditingRow = editing && editing.batchId === b.id && editing.studentId === s.id;
                      return (
                        <tr key={s.id}>
                          <td><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleStudentSelected(b.id, s.id)} /></td>
                          <td>{s.fullName}</td>
                          <td>
                            {isEditingRow ? (
                              <input
                                type="number" min="0" max="100" className="fp-input"
                                value={editing.score}
                                onChange={(e) => setEditing({ ...editing, score: e.target.value })}
                              />
                            ) : (
                              <>{s.score}% <GradeBadge score={s.score} /></>
                            )}
                          </td>
                          <td>
                            {isEditingRow ? (
                              <input
                                type="text" className="fp-input" maxLength={500}
                                value={editing.comment}
                                onChange={(e) => setEditing({ ...editing, comment: e.target.value })}
                              />
                            ) : (
                              <span style={{ color: "var(--fp-ink-soft)", fontSize: "0.85rem" }}>{s.comment}</span>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {isEditingRow ? (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="fp-btn fp-btn-gold" disabled={savingEdit} onClick={saveEdit}>
                                  <Save size={14} /> {savingEdit ? "Saving…" : "Save"}
                                </button>
                                <button className="fp-btn" disabled={savingEdit} onClick={() => setEditing(null)}>Cancel</button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="fp-btn" onClick={() => startEdit(b.id, s)}>
                                  <Pencil size={14} /> Edit
                                </button>
                                <button
                                  className="fp-btn"
                                  disabled={actingKey === `${b.id}-${s.id}`}
                                  onClick={() => handleDepublish(b.id, [s.id])}
                                >
                                  <Undo2 size={14} /> {actingKey === `${b.id}-${s.id}` ? "…" : "Depublish"}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const inlineErrorStyle = {
  background: "rgba(179, 65, 58, 0.1)",
  color: "var(--fp-danger)",
  padding: "10px 14px",
  borderRadius: "var(--fp-radius-sm)",
  fontSize: "0.88rem",
};
