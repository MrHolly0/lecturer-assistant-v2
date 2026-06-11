import type { components } from "./schema";
import { clearStoredAuth, getStoredAuth } from "../auth";
import { apiFetch, ApiError } from "./http";

export type ImportJob = components["schemas"]["ImportJob"];
export type SlideDeck = components["schemas"]["SlideDeck"];
export type SlideDeckDetails = components["schemas"]["SlideDeckDetails"];
export type Slide = components["schemas"]["Slide"];
export type SlideNote = components["schemas"]["SlideNote"];
export type Lecture = components["schemas"]["Lecture"];
export type LectureDetails = components["schemas"]["LectureDetails"];
export type Attachment = components["schemas"]["Attachment"];

export async function listDecks(courseId: string): Promise<SlideDeck[]> {
  const res = await apiFetch(`/courses/${courseId}/decks`);
  return res.json() as Promise<SlideDeck[]>;
}

export async function getDeck(courseId: string, deckId: string): Promise<SlideDeckDetails> {
  const res = await apiFetch(`/courses/${courseId}/decks/${deckId}`);
  return res.json() as Promise<SlideDeckDetails>;
}

export async function getImportJob(courseId: string, jobId: string): Promise<ImportJob> {
  const res = await apiFetch(`/courses/${courseId}/import-jobs/${jobId}`);
  return res.json() as Promise<ImportJob>;
}

export async function saveSlideNote(
  courseId: string,
  deckId: string,
  slideIndex: number,
  content: string
): Promise<SlideNote> {
  const res = await apiFetch(`/courses/${courseId}/decks/${deckId}/slides/${slideIndex}/notes`, {
    method: "PUT",
    body: JSON.stringify({ content })
  });
  return res.json() as Promise<SlideNote>;
}

export async function listLectures(courseId: string): Promise<Lecture[]> {
  const res = await apiFetch(`/courses/${courseId}/lectures`);
  return res.json() as Promise<Lecture[]>;
}

export async function createLecture(
  courseId: string,
  title: string,
  deckId: string
): Promise<Lecture> {
  const res = await apiFetch(`/courses/${courseId}/lectures`, {
    method: "POST",
    body: JSON.stringify({ title, deckId })
  });
  return res.json() as Promise<Lecture>;
}

export async function getLecture(courseId: string, lectureId: string): Promise<LectureDetails> {
  const res = await apiFetch(`/courses/${courseId}/lectures/${lectureId}`);
  return res.json() as Promise<LectureDetails>;
}

export function slideImageUrl(courseId: string, deckId: string, slideIndex: number): string {
  return `/api/v1/courses/${courseId}/decks/${deckId}/slides/${slideIndex}/image`;
}

export function uploadDeck(
  courseId: string,
  title: string,
  file: File,
  onProgress: (progress: number) => void
): Promise<ImportJob> {
  const form = new FormData();
  form.append("title", title);
  form.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/courses/${courseId}/decks`);
    xhr.withCredentials = true;
    xhr.responseType = "json";
    xhr.setRequestHeader("Accept", "application/json");

    const auth = getStoredAuth();
    if (auth) xhr.setRequestHeader("Authorization", `Bearer ${auth.accessToken}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 70));
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        clearStoredAuth();
        window.dispatchEvent(new CustomEvent("auth:expired"));
        reject(new ApiError(401, "Сессия истекла"));
        return;
      }
      if (xhr.status === 413) {
        reject(new ApiError(413, "Файл слишком большой для загрузки"));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, `Загрузка завершилась с ошибкой ${xhr.status}`));
        return;
      }
      onProgress(75);
      resolve(xhr.response as ImportJob);
    };
    xhr.onerror = () => reject(new ApiError(0, "Не удалось загрузить файл"));
    xhr.send(form);
  });
}
