import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes } from "react-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Layout } from "@/components/Layout"
import { CraftCalculator } from "@/routes/CraftCalculator"
import { CompactionCalculator } from "@/routes/CompactionCalculator"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/craft" replace />} />
            <Route path="/craft" element={<CraftCalculator />} />
            <Route path="/compact" element={<CompactionCalculator />} />
            <Route path="*" element={<Navigate to="/craft" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
