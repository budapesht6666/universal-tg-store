import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initTelegram } from "./lib/telegram.ts";
import { router } from "./router.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true },
  },
});

const root = createRoot(document.getElementById("root") as HTMLElement);

initTelegram()
  .then(() => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    root.render(
      <div style={{ padding: 32, textAlign: "center", fontFamily: "system-ui" }}>
        {err instanceof Error ? err.message : "Откройте магазин из Telegram"}
      </div>,
    );
  });
