export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const KNOWN_MESSAGES: Array<[RegExp, string]> = [
  [
    /invalid participant token|participant token does not belong to session/i,
    "Ссылка подключения устарела. Откройте лекцию заново."
  ],
  [/session deck has no slides/i, "В лекции пока нет доступных слайдов."],
  [/session not found/i, "Лекция не найдена. Проверьте код у преподавателя."],
  [/session is already ended/i, "Лекция завершена. Попросите преподавателя дать новый код."],
  [/poll is already closed/i, "Опрос уже закрыт. Дождитесь результатов."],
  [
    /validation failed|method argument not valid|failed to convert|json parse error/i,
    "Проверьте введённые данные и попробуйте снова."
  ],
  [
    /failed to fetch|networkerror|load failed|network request failed/i,
    "Нет связи с сервером. Проверьте интернет и повторите попытку."
  ]
];

const STATUS_MESSAGES: Record<number, string> = {
  0: "Нет связи с сервером. Проверьте интернет и повторите попытку.",
  400: "Проверьте введённые данные и попробуйте снова.",
  401: "Сессия истекла. Войдите снова.",
  403: "Недостаточно прав для этого действия.",
  404: "Запрошенные данные не найдены.",
  408: "Сервер не ответил вовремя. Повторите попытку.",
  409: "Действие конфликтует с текущим состоянием. Обновите страницу и попробуйте снова.",
  413: "Файл слишком большой для загрузки.",
  429: "Слишком много запросов. Подождите немного и повторите попытку."
};

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let serverMessage: string | undefined;
  let code: string | undefined;
  try {
    const data = (await response.clone().json()) as Record<string, unknown>;
    const errorValue = firstString(data.error);
    serverMessage = firstString(
      data.message,
      data.detail,
      errorValue && !isMachineCode(errorValue) ? errorValue : undefined
    );
    code = firstString(data.code, errorValue && isMachineCode(errorValue) ? errorValue : undefined);
    return new ApiError(
      response.status,
      localizeApiMessage(response.status, serverMessage),
      code,
      data
    );
  } catch {
    // Non-JSON responses are converted using the HTTP status.
  }
  return new ApiError(response.status, localizeApiMessage(response.status, serverMessage), code);
}

export function userErrorMessage(error: unknown, fallback = "Не удалось выполнить действие.") {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    const known = knownMessage(error.message);
    if (known) return known;
  }
  return fallback;
}

function localizeApiMessage(status: number, serverMessage?: string) {
  const known = knownMessage(serverMessage);
  if (known) return known;
  if (serverMessage && isSafeRussianMessage(serverMessage)) return serverMessage;
  if (status >= 500) return "Сервис временно недоступен. Повторите попытку позже.";
  return STATUS_MESSAGES[status] ?? `Не удалось выполнить запрос (код ${status}).`;
}

function knownMessage(message?: string) {
  if (!message) return undefined;
  return KNOWN_MESSAGES.find(([pattern]) => pattern.test(message))?.[1];
}

function isSafeRussianMessage(message: string) {
  return (
    message.length <= 240 &&
    /[А-Яа-яЁё]/.test(message) &&
    !/exception|org\.springframework|constraint|stack trace|sql state|validation failed/i.test(
      message
    )
  );
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "");
}

function isMachineCode(value: string) {
  return /^[A-Z][A-Z0-9_]+$/.test(value);
}
