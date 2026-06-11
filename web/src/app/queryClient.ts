import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api/http";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Недостаточно прав для действия.";
    if (error.status === 404) return "Данные не найдены.";
    if (error.status >= 500) return "Сервер временно недоступен.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Запрос завершился ошибкой.";
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error) => toast.error(errorMessage(error))
  }),
  queryCache: new QueryCache({
    onError: (error) => toast.error(errorMessage(error))
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
