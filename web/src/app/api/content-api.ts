import type { components } from "./schema";
import { expireStoredAuth, getStoredAuth } from "../auth";
import { apiFetch, ApiError } from "./http";
import { refreshAuthSession } from "./refresh";

export type ImportJob = components["schemas"]["ImportJob"];
export type SlideDeck = components["schemas"]["SlideDeck"];
export type SlideDeckDetails = components["schemas"]["SlideDeckDetails"];
export type Slide = components["schemas"]["Slide"];
export type SlideNote = components["schemas"]["SlideNote"];
export type Lecture = components["schemas"]["Lecture"];
export type LectureDetails = components["schemas"]["LectureDetails"];
export type Attachment = components["schemas"]["Attachment"];
export type DeckEditResult = components["schemas"]["DeckEditResult"];

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

export async function deleteSlideNote(
  courseId: string,
  deckId: string,
  slideIndex: number
): Promise<void> {
  await apiFetch(`/courses/${courseId}/decks/${deckId}/slides/${slideIndex}/notes`, {
    method: "DELETE"
  });
}

export async function deleteDeckSlide(
  courseId: string,
  deckId: string,
  slideId: string
): Promise<DeckEditResult> {
  const res = await apiFetch(`/courses/${courseId}/decks/${deckId}/slides/${slideId}`, {
    method: "DELETE"
  });
  return res.json() as Promise<DeckEditResult>;
}

export async function reorderDeckSlides(
  courseId: string,
  deckId: string,
  slideIds: string[]
): Promise<DeckEditResult> {
  const res = await apiFetch(`/courses/${courseId}/decks/${deckId}/slides/order`, {
    method: "PUT",
    body: JSON.stringify({ slideIds })
  });
  return res.json() as Promise<DeckEditResult>;
}

export async function archiveDeck(courseId: string, deckId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/decks/${deckId}`, { method: "DELETE" });
}

export async function restoreDeck(courseId: string, deckId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/decks/${deckId}/restore`, { method: "POST" });
}

export async function hardDeleteDeck(courseId: string, deckId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/decks/${deckId}/hard`, { method: "DELETE" });
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

export async function deleteLecture(courseId: string, lectureId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/lectures/${lectureId}`, { method: "DELETE" });
}

export async function restoreLecture(courseId: string, lectureId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/lectures/${lectureId}/restore`, { method: "POST" });
}

export async function hardDeleteLecture(courseId: string, lectureId: string): Promise<void> {
  await apiFetch(`/courses/${courseId}/lectures/${lectureId}/hard`, { method: "DELETE" });
}

export async function getLecture(courseId: string, lectureId: string): Promise<LectureDetails> {
  const res = await apiFetch(`/courses/${courseId}/lectures/${lectureId}`);
  return res.json() as Promise<LectureDetails>;
}

export async function deleteAttachment(
  courseId: string,
  lectureId: string,
  attachmentId: string
): Promise<void> {
  await apiFetch(`/courses/${courseId}/lectures/${lectureId}/attachments/${attachmentId}`, {
    method: "DELETE"
  });
}

export function slideImageUrl(slide: Pick<Slide, "imageUrl">): string {
  return slide.imageUrl;
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
    const send = (retried: boolean) => {
      const xhr = new XMLHttpRequest();
      const requestToken = getStoredAuth()?.accessToken ?? null;

      xhr.open("POST", `/api/v1/courses/${courseId}/decks`);
      xhr.withCredentials = true;
      xhr.responseType = "json";
      xhr.setRequestHeader("Accept", "application/json");
      if (requestToken) xhr.setRequestHeader("Authorization", `Bearer ${requestToken}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 70));
      };
      xhr.onload = async () => {
        if (xhr.status === 401 && !retried && requestToken) {
          const currentToken = getStoredAuth()?.accessToken ?? null;
          if (currentToken && currentToken !== requestToken) {
            send(true);
            return;
          }

          if (await refreshAuthSession()) {
            send(true);
            return;
          }
        }
        if (xhr.status === 401) {
          expireStoredAuth();
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
    };

    send(false);
  });
}
