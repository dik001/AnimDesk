import { lazy } from "react";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { NotificationProvider } from "../features/notifications/NotificationProvider";
import { RouteErrorPage } from "./RouteErrorPage";

const HomePage = lazy(() => import("../pages/HomePage"));
const SearchPage = lazy(() => import("../pages/SearchPage"));
const LibraryPage = lazy(() => import("../pages/LibraryPage"));
const ProfilePage = lazy(() => import("../pages/ProfilePage"));
const SettingsPage = lazy(() => import("../pages/SettingsPage"));
const AnimePage = lazy(() => import("../pages/AnimePage"));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage"));

const router = createHashRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "search", element: <SearchPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "anime/:provider/:id", element: <AnimePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return (
    <NotificationProvider>
      <button
        type="button"
        onClick={() => document.getElementById("main-content")?.focus()}
        className="sr-only z-50 rounded-lg bg-violet-accent p-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        К содержимому
      </button>
      <RouterProvider router={router} />
    </NotificationProvider>
  );
}
