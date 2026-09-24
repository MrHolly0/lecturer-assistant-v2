import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api/http";
import { userErrorMessage } from "./api/errors";

function reportError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) return;
  toast.error(userErrorMessage(error));
}

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError) return;
      reportError(error);
    }
  }),
  queryCache: new QueryCache({
    onError: reportError
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
