export type NotificationTone = "info" | "success" | "error";

export interface AppNotification {
  id: string;
  message: string;
  tone: NotificationTone;
}
