const KEY = "la_student_resume_v1";
const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export interface StudentResumeReceipt {
  joinCode: string;
  participantToken: string;
}

export function readStudentResume(joinCode?: string): StudentResumeReceipt | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StudentResumeReceipt>;
    if (
      typeof value.joinCode !== "string" ||
      !CODE_PATTERN.test(value.joinCode) ||
      typeof value.participantToken !== "string" ||
      value.participantToken.length < 20 ||
      (joinCode && value.joinCode !== joinCode)
    )
      return null;
    return value as StudentResumeReceipt;
  } catch {
    return null;
  }
}

export function storeStudentResume(receipt: StudentResumeReceipt): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(receipt));
  } catch {
    // The current tab can still continue when the WebView denies persistent storage.
  }
}

export function clearStudentResume(joinCode: string): void {
  try {
    if (readStudentResume(joinCode)) localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable in a private WebView.
  }
}

export function readTabStudentToken(joinCode: string): string | null {
  try {
    return sessionStorage.getItem(`student-session:${joinCode}`);
  } catch {
    return null;
  }
}

export function storeTabStudentToken(joinCode: string, token: string): void {
  try {
    sessionStorage.setItem(`student-session:${joinCode}`, token);
  } catch {
    // Persistent receipt and MAX identity can still restore the lecture.
  }
}
