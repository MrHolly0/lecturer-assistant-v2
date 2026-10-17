const KEY = "la_student_resume_v1";
const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export interface StudentResumeReceipt {
  joinCode: string;
  participantToken: string;
  userId?: string;
}

export function readStudentResume(
  joinCode?: string,
  userId?: string | null
): StudentResumeReceipt | null {
  try {
    return parseStudentResume(localStorage.getItem(KEY), joinCode, userId);
  } catch {
    return null;
  }
}

export function parseStudentResume(
  raw: string | null,
  joinCode?: string,
  userId?: string | null
): StudentResumeReceipt | null {
  try {
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StudentResumeReceipt>;
    const belongsToRequestedUser =
      userId === undefined ||
      (userId === null
        ? value.userId === undefined
        : value.userId === undefined || value.userId === userId);
    if (
      typeof value.joinCode !== "string" ||
      !CODE_PATTERN.test(value.joinCode) ||
      typeof value.participantToken !== "string" ||
      value.participantToken.length < 20 ||
      !belongsToRequestedUser ||
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

export function clearStudentResume(joinCode: string, userId?: string | null): void {
  try {
    if (readStudentResume(joinCode, userId)) localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable in a private WebView.
  }
}

function tabTokenKey(joinCode: string, userId: string | null): string {
  return userId === null
    ? `student-session:${joinCode}:guest`
    : `student-session:${joinCode}:user:${encodeURIComponent(userId)}`;
}

export function readTabStudentToken(joinCode: string, userId: string | null = null): string | null {
  try {
    return sessionStorage.getItem(tabTokenKey(joinCode, userId));
  } catch {
    return null;
  }
}

export function storeTabStudentToken(
  joinCode: string,
  token: string,
  userId: string | null = null
): void {
  try {
    sessionStorage.setItem(tabTokenKey(joinCode, userId), token);
    if (userId !== null) {
      sessionStorage.removeItem(tabTokenKey(joinCode, null));
      sessionStorage.removeItem(`student-session:${joinCode}`);
    }
  } catch {
    // Persistent receipt and MAX identity can still restore the lecture.
  }
}
