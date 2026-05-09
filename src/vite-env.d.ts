/// <reference types="vite/client" />

export type ChatStreamPayload = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type ChatsPayload = {
  version: number;
  sessions: unknown[];
  activeSessionId: string | null;
};

export type DsApi = {
  getSettings: () => Promise<Record<string, unknown>>;
  setSettings: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>;
  setThemeBackground: (theme: "light" | "dark") => Promise<boolean>;
  getChats: () => Promise<ChatsPayload>;
  setChats: (payload: ChatsPayload) => Promise<boolean>;
  startChat: (payload: ChatStreamPayload) => Promise<{ ok: boolean; error?: string }>;
  abortChat: () => Promise<boolean>;
  onChatChunk: (fn: (data: { text: string }) => void) => () => void;
  onChatReasoning: (fn: (data: { text: string }) => void) => () => void;
  onChatDone: (fn: (data: Record<string, never>) => void) => () => void;
  onChatAborted: (fn: (data: Record<string, never>) => void) => () => void;
  onChatError: (fn: (data: { message: string }) => void) => () => void;
};

declare global {
  interface Window {
    ds: DsApi;
  }
}

export {};
