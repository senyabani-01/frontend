// =============================================================================
// src/api/api.js
//
// THIS FILE IS THE SINGLE PLACE WHERE THE FRONTEND TALKS TO THE FASTAPI BACKEND.
// =============================================================================

import axios from "axios"; 

// Shared base URL configured strictly to the root "/api" prefix.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const http = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" }, 
});

// REQUEST INTERCEPTOR: Automatically attaches the JWT to requests.
http.interceptors.request.use((config) => {
  const token = localStorage.getItem("fp_access_token"); 
  if (token) {
    config.headers.Authorization = `Bearer ${token}`; 
  }
  return config; 
});

// RESPONSE INTERCEPTOR: Wipes local data and redirects on 401 expiration.
http.interceptors.response.use(
  (response) => response, 
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("fp_access_token"); 
      localStorage.removeItem("fp_user");         
      window.location.href = "/login";            
    }
    return Promise.reject(error); 
  }
);

// =============================================================================
// AUTH ENDPOINTS
// =============================================================================

export function registerStudent(payload) {
  // payload: { fullName, dateOfBirth, gradeLevel, email, password }
  return http.post("/auth/register", payload);
}

export function login(email, password) {
  return http.post("/auth/login", { email, password });
}

export function logout() {
  return http.post("/auth/logout").finally(() => {
    localStorage.removeItem("fp_access_token");
    localStorage.removeItem("fp_user");
  });
}

export function fetchMe() {
  return http.get("/auth/me");
}

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

export function adminListStudents(params = {}) {
  return http.get("/admin/students", { params });
}

export function adminCreateStudent(payload) {
  // STRICT LAYOUT EXPLICIT FIELDS:
  // payload layout: { fullName, email, password, dateOfBirth, gradeLevel }
  return http.post("/admin/students", payload);
}

// FIXED: Replaced flat quotes with template literal backticks so ID maps cleanly
export function adminDeleteStudent(studentId) {
  return http.delete(`/admin/students/${studentId}`);
}

export function adminActivateStudent(studentId) {
  return http.post(`/admin/students/${studentId}/activate`);
}

export function adminListTeachers() {
  return http.get("/admin/teachers");
}

export function adminGrantTeacherAccess(teacherId) {
  return http.post(`/admin/teachers/${teacherId}/grant-access`);
}

export function adminRevokeTeacherAccess(teacherId) {
  return http.post(`/admin/teachers/${teacherId}/revoke-access`);
}

// ROBUST ADDITION: For connecting teachers to their assigned classes & subjects
export function adminAssignTeacherClass(teacherId, { subject, gradeLevel }) {
  // Body columns map strictly to teacher_classes database table columns
  return http.post(`/admin/teachers/${teacherId}/classes`, { subject, gradeLevel });
}

export function adminListExams() {
  return http.get("/admin/exams");
}

export function adminCreateExam(payload) {
  // STRICT LAYOUT EXPLICIT FIELDS:
  // payload layout: { name, term, gradeLevel, subjects: ["Maths"], startDate, endDate }
  return http.post("/admin/exams", payload);
}

export function adminListPendingResults() {
  return http.get("/admin/results/pending");
}

// FIXED: Replaced flat quotes with template literal backticks
export function adminPublishResults(batchId, payload) {
  // payload (optional): { studentIds: number[] } - publish just those
  // students; omit it to publish the whole batch. Previously this dropped
  // the second argument entirely, so "Publish selected" silently published
  // everyone in the batch (the backend received no body, so it defaulted
  // to "publish all").
  return http.post(`/admin/results/${batchId}/publish`, payload);
}

// FIXED: Replaced flat quotes with template literal backticks
export function adminRejectResults(batchId, payload) {
  // payload: { reason: "..." } - passed straight through as the request
  // body. Previously this function's parameter was itself named `reason`
  // and got wrapped in ANOTHER `{ reason }` here - since callers already
  // pass `{ reason: "..." }`, the body that actually went out was
  // `{ reason: { reason: "..." } }`, a nested object where the backend
  // expects a bare string. That's what produced "reason: Input should be
  // a valid string".
  return http.post(`/admin/results/${batchId}/reject`, payload);
}

//----------------------------must be deleted l did the editing alone

export function adminCreateTeacher(payload) {
  // STRICT LAYOUT EXPLICIT FIELDS:
  // payload layout: { fullName, email, password, dateOfBirth, gradeLevel }
  return http.post("/admin/teachers", payload);
}

export function adminDeleteExam(exam_id) {
  return http.delete(`/admin/exams/${exam_id}`);
}

export function adminDeleteTeacher(email) {
  return http.delete(`/admin/teachers/${email}`);
}

export function adminDepublishResults(batchId, payload) {
  // payload (optional): { studentIds: number[] } - same fix as
  // adminPublishResults above: this used to drop the studentIds body, so a
  // single-student "Depublish" click always depublished the entire batch.
  return http.post(`/admin/results/${batchId}/depublish`, payload);
}



export function adminEditPublishedResult(markId, payload) {
  // payload: { score, comment }. Previously this referenced the undefined
  // variable `mark_id` (note the underscore - not the `batchId` parameter
  // actually in scope), sent no body at all, and POSTed to a URL with no
  // action segment instead of PATCHing the mark's own endpoint. That stray
  // `mark_id` reference is exactly the "mark_id is not defined" error -
  // it's a ReferenceError thrown here in the browser, not in the backend.
  return http.patch(`/admin/results/${markId}`, payload);
}


export function adminListPublishedResults() {
  return http.get(`/admin/results/published`);
}
//must be deleted coz l edited them alone




// =============================================================================
// TEACHER ENDPOINTS
// =============================================================================

export function teacherListClasses() {
  return http.get("/teacher/classes");
}

export function teacherListStudentsForMarking(examId, subject) {
  return http.get("/teacher/students", { params: { examId, subject } });
}

export function saveMark({ studentId, examId, subject, score, comment }) {
  return http.post("/teacher/marks", { studentId, examId, subject, score, comment });
}

export function saveMarksBatch({ examId, subject, entries }) {
  return http.post("/teacher/marks/batch", { examId, subject, entries });
}

export function submitResultsForPublication({ examId, subject }) {
  return http.post("/teacher/results/submit", { examId, subject });
}

// =============================================================================
// STUDENT ENDPOINTS
// =============================================================================

export function studentGetProfile() {
  return http.get("/student/profile");
}

export function studentListResults() {
  return http.get("/student/results");
}

export function studentGetTrends() {
  return http.get("/student/results/trends");
}
