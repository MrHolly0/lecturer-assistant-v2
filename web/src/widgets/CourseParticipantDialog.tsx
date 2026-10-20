import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { userErrorMessage } from "../app/api/errors";
import {
  addCourseMember,
  findCourseMemberCandidate,
  type CourseMember,
  type CourseMemberCandidate,
  type CourseRole,
  type AddCourseMemberRequest
} from "../app/api/courses-api";
import type { components } from "../app/api/schema";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../shared/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../shared/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../shared/ui/tabs";
import { CourseInvitePanel } from "./CourseInvitePanel";
import { CourseStaffPicker } from "./CourseStaffPicker";

type StudyGroup = components["schemas"]["StudyGroup"];
type ParticipantTab = "staff" | "existing" | "invite";
type AddMemberVariables = AddCourseMemberRequest & { courseId: string; request: number };

const ROLE_LABELS: Record<CourseRole, string> = {
  LECTURER: "Преподаватель",
  ASSISTANT: "Ассистент",
  STUDENT: "Студент"
};

export function CourseParticipantDialog({
  courseId,
  groups,
  members,
  open,
  onOpenChange,
  onAdded
}: {
  courseId: string;
  groups: StudyGroup[];
  members: CourseMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (member: CourseMember) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef("");
  const courseIdRef = useRef(courseId);
  const lookupSequence = useRef(0);
  const addSequence = useRef(0);
  const [tab, setTab] = useState<ParticipantTab>("staff");
  const [email, setEmail] = useState("");
  const [candidate, setCandidate] = useState<CourseMemberCandidate | null>(null);
  const [candidateCourseId, setCandidateCourseId] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "found" | "empty" | "error">(
    "idle"
  );
  const [lookupError, setLookupError] = useState("");
  const [role, setRole] = useState<CourseRole>("LECTURER");
  const [addError, setAddError] = useState("");

  courseIdRef.current = courseId;

  useEffect(() => {
    lookupSequence.current += 1;
    setCandidate(null);
    setCandidateCourseId(null);
    setLookupState("idle");
    setAddError("");
    if (open) {
      setTab("staff");
      setRole("LECTURER");
    }
  }, [open]);

  useEffect(() => {
    lookupSequence.current += 1;
    addSequence.current += 1;
    emailRef.current = "";
    setEmail("");
    setCandidate(null);
    setCandidateCourseId(null);
    setLookupState("idle");
    setLookupError("");
    setAddError("");
    setRole("LECTURER");
    setTab("staff");
    return () => {
      lookupSequence.current += 1;
      addSequence.current += 1;
    };
  }, [courseId]);

  const addMutation = useMutation({
    mutationFn: (variables: AddMemberVariables) =>
      addCourseMember(variables.courseId, {
        personId: variables.personId,
        role: variables.role
      }),
    onSuccess: (member, variables) => {
      if (variables.courseId !== courseIdRef.current || variables.request !== addSequence.current)
        return;
      onAdded(member);
      onOpenChange(false);
    },
    onError: (error, variables) => {
      if (variables.courseId !== courseIdRef.current || variables.request !== addSequence.current)
        return;
      setAddError(userErrorMessage(error, "Не удалось добавить участника."));
    }
  });

  async function lookup() {
    const searchedEmail = email.trim();
    if (!searchedEmail) {
      setLookupState("error");
      setLookupError("Введите адрес электронной почты.");
      setCandidate(null);
      setCandidateCourseId(null);
      return;
    }
    if (emailInputRef.current && !emailInputRef.current.checkValidity()) {
      setLookupState("error");
      setLookupError("Введите корректный адрес электронной почты.");
      setCandidate(null);
      setCandidateCourseId(null);
      return;
    }
    const sequence = ++lookupSequence.current;
    const searchedCourseId = courseId;
    emailRef.current = email;
    setCandidate(null);
    setLookupError("");
    setLookupState("loading");
    try {
      const candidates = await findCourseMemberCandidate(searchedCourseId, searchedEmail);
      if (
        sequence !== lookupSequence.current ||
        courseIdRef.current !== searchedCourseId ||
        emailRef.current !== email
      ) {
        return;
      }
      setCandidate(candidates[0] ?? null);
      setCandidateCourseId(candidates.length > 0 ? searchedCourseId : null);
      setLookupState(candidates.length > 0 ? "found" : "empty");
    } catch (error) {
      if (
        sequence !== lookupSequence.current ||
        courseIdRef.current !== searchedCourseId ||
        emailRef.current !== email
      ) {
        return;
      }
      setLookupError(userErrorMessage(error, "Не удалось найти аккаунт."));
      setLookupState("error");
    }
  }

  function changeEmail(value: string) {
    emailRef.current = value;
    lookupSequence.current += 1;
    setEmail(value);
    setCandidate(null);
    setCandidateCourseId(null);
    setLookupState("idle");
    setLookupError("");
    setAddError("");
  }

  function setOpen(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setTab("staff");
      setAddError("");
    }
  }

  const canAdd =
    tab !== "invite" &&
    candidate !== null &&
    candidateCourseId === courseId &&
    !candidate.alreadyMember &&
    !addMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="course-participant-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="course-participant-dialog__header">
          <DialogTitle asChild>
            <h2 ref={titleRef} tabIndex={-1} className="course-participant-dialog__title">
              Добавить ведущего
            </h2>
          </DialogTitle>
          <DialogDescription>
            Выберите сотрудника, найдите аккаунт по почте или создайте приглашение.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            lookupSequence.current += 1;
            setTab(value as ParticipantTab);
            setCandidate(null);
            setCandidateCourseId(null);
            setLookupState("idle");
            setAddError("");
          }}
          className="course-participant-dialog__content"
        >
          <TabsList className="course-participant-dialog__tabs" aria-label="Способ добавления">
            <TabsTrigger
              value="staff"
              className="course-participant-dialog__tab"
              disabled={addMutation.isPending}
            >
              Сотрудники
            </TabsTrigger>
            <TabsTrigger
              value="existing"
              className="course-participant-dialog__tab"
              disabled={addMutation.isPending}
            >
              По email
            </TabsTrigger>
            <TabsTrigger
              value="invite"
              className="course-participant-dialog__tab"
              disabled={addMutation.isPending}
            >
              Приглашение
            </TabsTrigger>
          </TabsList>

          <div className="course-participant-dialog__body">
            {open && tab === "staff" && (
              <CourseStaffPicker
                courseId={courseId}
                memberIds={members.map((member) => member.personId)}
                selectedId={candidate?.personId}
                disabled={addMutation.isPending}
                onSelect={(member) => {
                  lookupSequence.current += 1;
                  setCandidate({
                    personId: member.id,
                    displayName: member.displayName,
                    alreadyMember: members.some((current) => current.personId === member.id)
                  });
                  setCandidateCourseId(courseId);
                  setEmail(member.email);
                  setRole(member.role === "ASSISTANT" ? "ASSISTANT" : "LECTURER");
                  setAddError("");
                }}
              />
            )}
            <TabsContent
              value="existing"
              forceMount
              hidden={tab !== "existing"}
              className="course-participant-dialog__panel"
            >
              <form
                className="course-participant-dialog__lookup"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!addMutation.isPending && lookupState !== "loading") void lookup();
                }}
              >
                <label className="field" htmlFor="course-participant-email">
                  <span>Электронная почта аккаунта</span>
                  <input
                    ref={emailInputRef}
                    id="course-participant-email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    disabled={addMutation.isPending}
                    value={email}
                    onChange={(event) => changeEmail(event.target.value)}
                    placeholder="name@example.com"
                    aria-describedby="course-participant-email-help"
                    maxLength={254}
                  />
                </label>
                <small className="muted" id="course-participant-email-help">
                  Введите полный адрес, чтобы найти конкретный аккаунт.
                </small>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={lookupState === "loading" || addMutation.isPending}
                >
                  {lookupState === "loading"
                    ? "Ищем…"
                    : lookupState === "error"
                      ? "Повторить поиск"
                      : "Найти"}
                </Button>
              </form>

              {lookupState === "loading" && (
                <p className="course-participant-dialog__status" role="status">
                  Ищем аккаунт…
                </p>
              )}
              {lookupState === "empty" && (
                <p className="course-participant-dialog__status" role="status">
                  Аккаунт с таким адресом не найден. Проверьте адрес и повторите поиск.
                </p>
              )}
              {lookupState === "error" && (
                <p
                  className="course-participant-dialog__status course-participant-dialog__status--error"
                  role="alert"
                >
                  {lookupError}
                </p>
              )}
            </TabsContent>

            {tab !== "invite" && (
              <>
                {candidate && candidateCourseId === courseId && (
                  <div className="course-participant-dialog__candidate" aria-live="polite">
                    <span className="course-participant-dialog__candidate-label">
                      Найденный аккаунт
                    </span>
                    <strong className="course-participant-dialog__candidate-name">
                      {candidate.displayName}
                    </strong>
                    <span className="course-participant-dialog__candidate-email">
                      {email.trim()}
                    </span>
                    {candidate.alreadyMember && (
                      <p className="course-participant-dialog__status" role="status">
                        Этот человек уже участвует в курсе.
                      </p>
                    )}
                  </div>
                )}

                {candidate && candidateCourseId === courseId && !candidate.alreadyMember && (
                  <div className="course-participant-dialog__assignment">
                    <label className="field">
                      <span>Роль в курсе</span>
                      <Select
                        value={role}
                        disabled={addMutation.isPending}
                        onValueChange={(value) => {
                          setRole(value as CourseRole);
                          setAddError("");
                        }}
                      >
                        <SelectTrigger aria-label="Роль в курсе">
                          <SelectValue>{ROLE_LABELS[role]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ASSISTANT">Ассистент</SelectItem>
                          <SelectItem value="LECTURER">Преподаватель</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                )}

                {addError && (
                  <p
                    className="course-participant-dialog__status course-participant-dialog__status--error"
                    role="alert"
                  >
                    {addError}
                  </p>
                )}
              </>
            )}

            <TabsContent
              value="invite"
              forceMount
              hidden={tab !== "invite"}
              className="course-participant-dialog__panel"
            >
              <CourseInvitePanel courseId={courseId} groups={groups} staffOnly />
            </TabsContent>
          </div>

          {tab !== "invite" && (
            <DialogFooter className="course-participant-dialog__footer">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Закрыть
              </Button>
              <Button
                type="button"
                disabled={!canAdd}
                onClick={() => {
                  if (!canAdd || !candidate) return;
                  setAddError("");
                  addMutation.mutate({
                    courseId,
                    request: ++addSequence.current,
                    personId: candidate.personId,
                    role
                  });
                }}
              >
                {addMutation.isPending ? "Добавляем…" : "Добавить в курс"}
              </Button>
            </DialogFooter>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
