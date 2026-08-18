// =============================================================================
// src/pages/TeacherDashboard.jsx
//
// A teacher lands here to:
//   1. Pick one of their assigned classes, grouped clearly by subject AND
//      class (e.g. "Combined Science (Form 2 Yellow)")
//   2. Enter a mark + comment (max 500 characters) for each student, by
//      student ID, in that class - fields stay editable until published
//   3. Submit the completed mark sheet to the admin's publish queue
//
// Note: the "Submit for publication" button only works if an admin has
// granted this teacher's account "canPublishResults" (see AdminDashboard's
// Teacher access panel) - the backend enforces that permission again
// server-side, since the frontend can't be trusted to gate it alone.
//
// FIX ("examId: Field required" on publish): the class objects returned by
// GET /api/teacher/classes don't reliably carry the exam's id under the key
// `examId` in every backend response shape - some responses nest it as
// `exam.id`, some send `examID`, some send a bare `id` that IS the exam id
// for that row. Previously the UI blindly read `selectedClass.examId`; if
// that came back undefined, JSON.stringify() DROPS the key entirely from
// the request body, which is exactly what Pydantic reports back as
// "examId: Field required". normalizeClass() below tries every reasonable
// key so the id is found regardless of backend shape, and the Save/Submit
// buttons are now disabled with a clear inline message on the rare case
// none of them are present, instead of firing a request that is guaranteed
// to fail.
// =============================================================================

import { useEffect, useState } from "react";
import { GraduationCap, Send } from "lucide-react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import {
  teacherListClasses,
  teacherListStudentsForMarking,
  saveMarksBatch,
  submitResultsForPublication,
} from "../api/api";

// -----------------------------------------------------------------------------
// FastAPI/Pydantic serializes fields in snake_case (exam_id, grade_level...)
// but this component reads camelCase (selectedClass.examId...). That
// mismatch was the actual cause of "Record marks isn't working": examId
// came back undefined, so the roster request below went out for an empty
// exam id and silently failed. camelizeKeys() recurses through every
// response before it's stored in state, fixing that in one place. It's a
// no-op if your backend already returns camelCase.
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

// See the top-of-file note: tries every reasonable shape a backend might
// use to carry the exam id on a "class" row, so a naming mismatch never
// again silently drops the field and breaks publish.
function normalizeClass(c) {
  const examId = c.examId ?? c.examID ?? c.exam_id ?? c.exam?.id ?? c.examSittingId ?? c.classId ?? c.id ?? null;
  return { ...c, examId };
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
// Cambridge-style grade band shown next to every percentage score, on both
// the teacher and student pages. These boundaries mirror the standard
// Cambridge O-Level / IGCSE letter-grade bands (A*-G, U) - adjust the table
// below if the school's real moderation grid differs.
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
// Quick-insert comment suggestions - saves a teacher from retyping common
// feedback for every student. Selecting one appends it to that student's
// comment (respecting the character limit) rather than overwriting
// anything already typed.
// -----------------------------------------------------------------------------
const COMMENT_SUGGESTIONS = [
  "Excellent grasp of the subject; keep up the outstanding work.",
  "Good effort this term; more practice on written questions will help.",
  "Solid understanding of theory; needs to strengthen practical application.",
  "Struggling with core concepts; extra support sessions are recommended.",
  "Consistent and hardworking; refining exam technique will lift the score further.",
  "Bright potential, but homework needs to be submitted more consistently.",
  "Participates well in class; written work needs more detail and structure.",
  "Significant improvement on the last assessment; well done.",
];

const TABS = [{ key: "marks", label: "Record marks", icon: GraduationCap }];
const COMMENT_MAX_LENGTH = 200;

export default function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState("marks");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Navbar />
      <div style={{ display: "flex", flex: 1 }}>
        <Sidebar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
        <main style={{ flex: 1, padding: "28px 32px", overflow: "auto" }}>
          {activeTab === "marks" && <MarksPanel />}
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

function MarksPanel() {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [students, setStudents] = useState([]);
  const [marks, setMarks] = useState({}); // { studentId: { score, comment } }

  const [classesLoading, setClassesLoading] = useState(true);
  const [classesError, setClassesError] = useState("");

  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Whether every student in the currently-selected class is locked
  // (published) - used to grey out the class-wide Save/Submit buttons.
  // Individual rows lock independently via marks[s.id].locked, which comes
  // straight from GET /api/teacher/students' real is_published flag per
  // student now, instead of the class-wide guess this used to be.
  const allLocked = students.length > 0 && students.every((s) => marks[s.id]?.locked);
  const anyLocked = students.some((s) => marks[s.id]?.locked);

  async function loadClasses() {
    setClassesLoading(true);
    setClassesError("");
    try {
      const res = await teacherListClasses(); // GET /api/teacher/classes
      // camelizeKeys() + normalizeClass() together are the fix for both
      // "Record marks isn't working" and the "examId: Field required"
      // publish error - see the top-of-file note for the full explanation.
      const raw = camelizeKeys(Array.isArray(res.data) ? res.data : []);
      const data = raw.map(normalizeClass);
      setClasses(data);
      setSelectedClass(data.length > 0 ? data[0] : null);
    } catch (err) {
      setClassesError(getErrorMessage(err, "Could not load your classes. Check your connection and try again."));
    } finally {
      setClassesLoading(false);
    }
  }

  useEffect(() => {
    loadClasses();
  }, []);

  useEffect(() => {
    if (!selectedClass) {
      setStudents([]);
      setMarks({});
      return;
    }

    let cancelled = false;

    async function loadRoster() {
      setRosterLoading(true);
      setRosterError("");
      setSubmitted(false);
      setSaveSuccess("");
      setSaveError("");
      try {
        const res = await teacherListStudentsForMarking(selectedClass.examId, selectedClass.subject); // GET /api/teacher/students
        if (cancelled) return;
        const data = camelizeKeys(Array.isArray(res.data) ? res.data : []);
        setStudents(data);
        const initialMarks = {};
        data.forEach((s) => {
          initialMarks[s.id] = { score: s.score ?? "", comment: s.comment ?? "", absent: !!s.absent, locked: !!s.isPublished };
        });
        setMarks(initialMarks);
      } catch (err) {
        if (!cancelled) {
          setRosterError(getErrorMessage(err, "Could not load this class's roster. Check your connection and try again."));
        }
      } finally {
        if (!cancelled) setRosterLoading(false);
      }
    }

    loadRoster();
    return () => {
      cancelled = true;
    };
  }, [selectedClass]);

  function updateMark(studentId, field, value) {
    setSaveSuccess("");
    setMarks((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], [field]: value },
    }));
  }

  // Marks a student absent/no-mark for this exam - clears and disables the
  // score field (an absent student has no percentage to show a grade for)
  // but leaves the comment editable, since a teacher may still want to note
  // why the student was absent.
  function toggleAbsent(studentId) {
    setSaveSuccess("");
    setMarks((prev) => {
      const wasAbsent = !!prev[studentId]?.absent;
      return {
        ...prev,
        [studentId]: { ...prev[studentId], absent: !wasAbsent, score: wasAbsent ? "" : "" },
      };
    });
  }

  function insertSuggestion(studentId, suggestion) {
    setMarks((prev) => {
      const current = prev[studentId]?.comment || "";
      const merged = current.trim() ? `${current.trim()} ${suggestion}` : suggestion;
      return { ...prev, [studentId]: { ...prev[studentId], comment: merged.slice(0, COMMENT_MAX_LENGTH) } };
    });
  }

  function validateMarks() {
    for (const s of students) {
      if (marks[s.id]?.locked) continue; // read-only; not part of what gets submitted
      if (marks[s.id]?.absent) continue; // no score expected for an absent student
      const raw = marks[s.id]?.score;
      if (raw !== "" && raw !== undefined) {
        const num = Number(raw);
        if (Number.isNaN(num) || num < 0 || num > 100) {
          return `${s.fullName}'s score must be a number between 0 and 100.`;
        }
      }
      const comment = marks[s.id]?.comment || "";
      if (comment.length > COMMENT_MAX_LENGTH) {
        return `${s.fullName}'s comment is over the ${COMMENT_MAX_LENGTH}-character limit.`;
      }
    }
    return "";
  }

  async function handleSave({ silent } = {}) {
    if (!selectedClass?.examId) {
      setSaveError("Could not identify which examination this class belongs to. Please reselect the class, or contact an admin if this keeps happening.");
      return false;
    }

    const validationError = validateMarks();
    if (validationError) {
      setSaveError(validationError);
      setSaveSuccess("");
      return false;
    }

    setSaveError("");
    setSaveSuccess("");
    setSaving(true);
    try {
      const entries = students
        .filter((s) => !marks[s.id]?.locked) // published rows are read-only; the backend would skip them anyway, but no need to send them
        .map((s) => ({
          studentId: s.id,
          score: marks[s.id]?.absent ? null : (marks[s.id]?.score === "" ? null : Number(marks[s.id]?.score)),
          comment: (marks[s.id]?.comment || "").slice(0, COMMENT_MAX_LENGTH),
        }));
      const res = await saveMarksBatch({ examId: selectedClass.examId, subject: selectedClass.subject, entries }); // POST /api/teacher/marks/batch
      // "Save draft" is a standalone action too (not just a step inside
      // Submit for publication), so it needs its own success feedback -
      // silent is passed by handleSubmitForPublication, which shows its
      // own "submitted" banner instead so the two don't stack.
      if (!silent) {
        setSaveSuccess(`Draft saved. You'll find it here under ${selectedClass.subject} (${selectedClass.gradeLevel}) whenever you come back to this class.`);
      }
      return true;
    } catch (err) {
      setSaveError(getErrorMessage(err, "Could not save the mark sheet. Please try again."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitForPublication() {
    if (!selectedClass?.examId) {
      setSubmitError("Could not identify which examination this class belongs to. Please reselect the class, or contact an admin if this keeps happening.");
      return;
    }

    setSubmitError("");
    setSubmitted(false);
    setSubmitting(true);
    try {
      const saveOk = await handleSave({ silent: true });
      if (!saveOk) return;
      await submitResultsForPublication({ examId: selectedClass.examId, subject: selectedClass.subject }); // POST /api/teacher/results/submit
      setSubmitted(true);
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Could not submit these results for publication. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const missingExamId = !!selectedClass && !selectedClass.examId;

  return (
    <section>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 4 }}>Record marks</h2>
        <p style={{ color: "var(--fp-ink-soft)", fontSize: "0.92rem" }}>
          Enter each student's score and a comment (max {COMMENT_MAX_LENGTH} characters), then submit for the admin to publish.
        </p>
      </div>

      {classesLoading ? (
        <p style={{ color: "var(--fp-ink-soft)" }}>Loading your classes…</p>
      ) : classesError ? (
        <LoadErrorBanner message={classesError} onRetry={loadClasses} />
      ) : classes.length === 0 ? (
        <div className="fp-card fp-empty">You haven't been assigned any classes yet. Contact an administrator.</div>
      ) : (
        <>
          {/* Classes grouped clearly by subject AND class/stream, so a
              teacher with several sections can tell them apart at a glance
              instead of picking a plain exam name from a dropdown. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 22 }}>
            {classes.map((c) => {
              const key = `${c.examId ?? c.id}-${c.subject}-${c.gradeLevel}`;
              const isActive = selectedClass && `${selectedClass.examId ?? selectedClass.id}-${selectedClass.subject}-${selectedClass.gradeLevel}` === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`fp-btn ${isActive ? "fp-btn-gold" : ""}`}
                  onClick={() => setSelectedClass(c)}
                  style={{ fontWeight: isActive ? 700 : 500 }}
                >
                  {c.subject} <span style={{ opacity: 0.75, fontWeight: 400 }}>({c.gradeLevel})</span>
                </button>
              );
            })}
          </div>

          {missingExamId && (
            <LoadErrorBanner message="This class is missing its examination reference from the server, so marks for it can't be saved or published yet. Try refreshing, or ask an admin to check this class's setup." />
          )}

          {allLocked && (
            <div className="fp-card" style={{ marginBottom: 16, background: "rgba(224,164,88,0.12)", borderColor: "var(--fp-gold)" }}>
              Every result in this class has been published by the admin, so it's locked here. Ask the admin to depublish/reject it - editing reopens automatically once they do.
            </div>
          )}
          {!allLocked && anyLocked && (
            <div className="fp-card" style={{ marginBottom: 16, background: "rgba(224,164,88,0.12)", borderColor: "var(--fp-gold)" }}>
              Some students below are published and locked (marked with a badge) - the rest are still editable.
            </div>
          )}

          {submitted && (
            <div className="fp-card" style={{ marginBottom: 16, background: "rgba(45,106,79,0.08)", borderColor: "var(--fp-canopy)" }}>
              Submitted to the admin for review. You can keep editing until it's published.
            </div>
          )}

          {saveSuccess && (
            <div className="fp-card" style={{ marginBottom: 16, background: "rgba(45,106,79,0.08)", borderColor: "var(--fp-canopy)" }}>
              {saveSuccess}
            </div>
          )}

          {saveError && <LoadErrorBanner message={saveError} />}
          {submitError && <LoadErrorBanner message={submitError} />}

          {rosterLoading ? (
            <p style={{ color: "var(--fp-ink-soft)" }}>Loading class roster…</p>
          ) : rosterError ? (
            <LoadErrorBanner
              message={rosterError}
              onRetry={() => setSelectedClass((prev) => (prev ? { ...prev } : prev))}
            />
          ) : students.length === 0 ? (
            <div className="fp-card fp-empty">No students found for this class.</div>
          ) : (
            <div className="fp-card" style={{ padding: 0, overflow: "hidden" }}>
              <table className="fp-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Student</th>
                    <th>Subject</th>
                    <th style={{ width: 170 }}>Score (%)</th>
                    <th style={{ width: 360 }}>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const commentLength = (marks[s.id]?.comment || "").length;
                    const absent = !!marks[s.id]?.absent;
                    const rowLocked = !!marks[s.id]?.locked;
                    return (
                      <tr key={s.id}>
                        <td style={{ color: "var(--fp-ink-soft)" }}>{s.id}</td>
                        <td>
                          {s.fullName}
                          {rowLocked && (
                            <span className="fp-badge fp-badge-gold" style={{ marginLeft: 8, fontSize: "0.68rem" }}>Published</span>
                          )}
                        </td>
                        <td>{selectedClass.subject}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {absent ? (
                              <input
                                type="text"
                                className="fp-input"
                                value="X"
                                disabled
                                style={{ width: 64, textAlign: "center", fontWeight: 700 }}
                              />
                            ) : (
                              <>
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  className="fp-input"
                                  value={marks[s.id]?.score ?? ""}
                                  onChange={(e) => updateMark(s.id, "score", e.target.value)}
                                  disabled={rowLocked}
                                  style={{ width: 90, fontSize: "1rem" }}
                                />
                                <GradeBadge score={marks[s.id]?.score} />
                              </>
                            )}
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.72rem", color: "var(--fp-ink-soft)", whiteSpace: "nowrap" }}>
                              <input type="checkbox" checked={absent} disabled={rowLocked} onChange={() => toggleAbsent(s.id)} />
                              Absent / no mark
                            </label>
                          </div>
                        </td>
                        <td>
                          <textarea
                            className="fp-input"
                            placeholder="e.g. Strong grasp of practicals, needs to revise theory."
                            maxLength={COMMENT_MAX_LENGTH}
                            value={marks[s.id]?.comment ?? ""}
                            onChange={(e) => updateMark(s.id, "comment", e.target.value)}
                            disabled={rowLocked}
                            rows={3}
                            style={{ width: "100%", resize: "vertical", whiteSpace: "pre-wrap", wordWrap: "break-word", overflowWrap: "break-word", lineHeight: 1.4, fontFamily: "inherit" }}
                          />
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 8 }}>
                            <select
                              className="fp-input"
                              style={{ fontSize: "0.75rem", padding: "2px 6px", flex: 1 }}
                              value=""
                              disabled={rowLocked}
                              onChange={(e) => {
                                if (e.target.value) insertSuggestion(s.id, e.target.value);
                                e.target.value = "";
                              }}
                            >
                              <option value="">✨ Insert suggestion…</option>
                              {COMMENT_SUGGESTIONS.map((sugg) => (
                                <option key={sugg} value={sugg}>
                                  {sugg.length > 60 ? `${sugg.slice(0, 60)}…` : sugg}
                                </option>
                              ))}
                            </select>
                            <div style={{ fontSize: "0.72rem", color: "var(--fp-ink-soft)", whiteSpace: "nowrap" }}>
                              {commentLength}/{COMMENT_MAX_LENGTH}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {students.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button className="fp-btn fp-btn-ghost" onClick={() => handleSave()} disabled={saving || submitting || missingExamId || allLocked}>
                {saving ? "Saving…" : "Save draft"}
              </button>
              <button className="fp-btn fp-btn-gold" onClick={handleSubmitForPublication} disabled={saving || submitting || missingExamId || allLocked}>
                <Send size={16} /> {submitting ? "Submitting…" : "Submit for publication"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
