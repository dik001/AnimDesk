import { createContext } from "react";
import type { NotificationTone } from "./notificationTypes";

export interface NotificationContextValue {
  notify: (message: string, tone?: NotificationTone) => void;
}

export const NotificationContext =
  createContext<NotificationContextValue | null>(null);
