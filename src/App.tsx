import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "./MarkdownContent";

type TextPart = { kind: "text"; text: string };
type ImagePart = { kind: "image"; dataUrl: string };
type UserParts = Array<TextPart | ImagePart>;

type ChatMessage =
  | { id: string; role: "system"; content: string }
  | { id: string; role: "user"; parts: UserParts }
  | {
      id: string;
      role: "assistant";
      content: string;
      reasoning: string;
      incomplete?: boolean;
    };

type AppSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  thinkingEnabled: boolean;
  theme: "light" | "dark";
};

type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

const defaultSettings: AppSettings = {
  apiKey: "",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-v4-pro",
  systemPrompt: "",
  thinkingEnabled: true,
  theme: "light",
};

/** Main chat draft textarea: grows with content, then scrolls inside when taller than this. */
const DRAFT_TEXTAREA_MAX_HEIGHT_PX = 400;

/** Distance from bottom (px) to still count as “following” the stream / latest messages. */
const MSG_SCROLL_NEAR_BOTTOM_PX = 140;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object";
}

function sessionTitleFromMessages(msgs: ChatMessage[]) {
  const u = msgs.find((m) => m.role === "user");
  if (!u || u.role !== "user") return "新对话";
  const text = u.parts
    .filter((p): p is TextPart => p.kind === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
  if (!text) return "图片消息";
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function freshSessions(): { sessions: ChatSession[]; activeSessionId: string } {
  const id = uid();
  return {
    sessions: [{ id, title: "新对话", messages: [], updatedAt: Date.now() }],
    activeSessionId: id,
  };
}

function normalizeLoadedChats(data: unknown): { sessions: ChatSession[]; activeSessionId: string } {
  if (!isRecord(data)) return freshSessions();
  const rawSessions = data.sessions;
  if (!Array.isArray(rawSessions) || rawSessions.length === 0) return freshSessions();

  const sessions: ChatSession[] = [];
  for (const row of rawSessions) {
    if (!isRecord(row)) continue;
    const id = typeof row.id === "string" ? row.id : uid();
    const title = typeof row.title === "string" ? row.title : "新对话";
    const updatedAt = typeof row.updatedAt === "number" ? row.updatedAt : Date.now();
    const messages = Array.isArray(row.messages) ? (row.messages as ChatMessage[]) : [];
    sessions.push({ id, title, updatedAt, messages });
  }
  if (sessions.length === 0) return freshSessions();

  let activeSessionId = typeof data.activeSessionId === "string" ? data.activeSessionId : "";
  if (!sessions.some((s) => s.id === activeSessionId)) activeSessionId = sessions[0].id;

  return { sessions, activeSessionId };
}

function normalizeBaseUrl(raw: string) {
  const t = raw.trim().replace(/\/+$/, "");
  return t || "https://api.deepseek.com/v1";
}

/** DeepSeek Chat API：仅 v4 系列等多模态模型接受 image_url；v2/v3 等会返回 400。 */
function modelSupportsVision(modelId: string): boolean {
  const m = modelId.trim().toLowerCase();
  const id = m || "deepseek-v4-pro";
  if (id.includes("deepseek-v4")) return true;
  if (/\bv4[-_]?(flash|pro)\b/.test(id)) return true;
  return false;
}

function resizeDataUrlIfLarge(dataUrl: string, maxSide = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      if (scale >= 1) {
        resolve(dataUrl);
        return;
      }
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const mime = dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      resolve(c.toDataURL(mime, mime === "image/jpeg" ? quality : undefined));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function userPartsToApiContent(parts: UserParts, vision: boolean): string | unknown[] {
  const texts = parts.filter((p): p is TextPart => p.kind === "text").map((p) => p.text.trim());
  const images = parts.filter((p): p is ImagePart => p.kind === "image");
  if (images.length === 0) {
    return texts.join("\n").trim() || " ";
  }
  if (!vision) {
    const joined = texts.join("\n").trim();
    const note = "\n\n[本条含图片；当前模型不支持视觉，图片未提交给接口]";
    if (joined) return joined + note;
    return `[图片]${note}`;
  }
  const content: unknown[] = [];
  const joined = texts.join("\n").trim();
  if (joined) content.push({ type: "text", text: joined });
  for (const im of images) {
    content.push({
      type: "image_url",
      image_url: { url: im.dataUrl },
    });
  }
  if (content.length === 0) content.push({ type: "text", text: " " });
  return content;
}

function toApiMessages(messages: ChatMessage[], vision: boolean) {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const t = m.content.trim();
      if (t) out.push({ role: "system", content: t });
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: userPartsToApiContent(m.parts, vision) });
      continue;
    }
    const a: Record<string, unknown> = { role: "assistant", content: m.content };
    if (m.reasoning.trim()) a.reasoning_content = m.reasoning;
    out.push(a);
  }
  return out;
}

function useStreamBatcher(onFlush: (text: string) => void) {
  const buf = useRef("");
  const raf = useRef<number | null>(null);

  const push = useCallback(
    (chunk: string) => {
      buf.current += chunk;
      if (raf.current != null) return;
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        const t = buf.current;
        buf.current = "";
        if (t) onFlush(t);
      });
    },
    [onFlush],
  );

  const flushSync = useCallback(() => {
    if (raf.current != null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    const t = buf.current;
    buf.current = "";
    if (t) onFlush(t);
  }, [onFlush]);

  return { push, flushSync };
}

/** 侧栏收起 / 展开共用：圆角方框 + 靠左竖线（左窄侧栏 + 主内容区） */
function SidebarToggleGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="5" width="16" height="14" rx="4" />
      <line x1="7.5" y1="5" x2="7.5" y2="19" />
    </svg>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [chatsReady, setChatsReady] = useState(false);
  const [draftParts, setDraftParts] = useState<UserParts>([{ kind: "text", text: "" }]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const msgScrollRef = useRef<HTMLDivElement | null>(null);
  /** User is at (or near) the bottom — auto-scroll on new chunks; wheel / scrollbar up clears this until they return. */
  const stickToBottomRef = useRef(true);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef("");
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const draftText = useMemo(() => {
    const t = draftParts.find((p) => p.kind === "text");
    return t && t.kind === "text" ? t.text : "";
  }, [draftParts]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    stickToBottomRef.current = true;
  }, [activeSessionId]);

  useEffect(() => {
    void (async () => {
      const raw = await window.ds.getChats();
      const next = normalizeLoadedChats(raw);
      setSessions(next.sessions);
      setActiveSessionId(next.activeSessionId);
      setChatsReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!chatsReady) return;
    const t = window.setTimeout(() => {
      void window.ds.setChats({
        version: 1,
        sessions,
        activeSessionId,
      });
    }, 450);
    return () => window.clearTimeout(t);
  }, [sessions, activeSessionId, chatsReady]);

  useEffect(() => {
    if (sessions.length > 0 && !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const messages = useMemo(() => {
    const s = sessions.find((x) => x.id === activeSessionId);
    return s?.messages ?? [];
  }, [sessions, activeSessionId]);

  const setMessages = useCallback((action: React.SetStateAction<ChatMessage[]>) => {
    const aid = activeSessionIdRef.current;
    setSessions((prev) =>
      prev.map((sess) => {
        if (sess.id !== aid) return sess;
        const nextMsgs = typeof action === "function" ? action(sess.messages) : action;
        return {
          ...sess,
          messages: nextMsgs,
          updatedAt: Date.now(),
          title: sessionTitleFromMessages(nextMsgs),
        };
      }),
    );
  }, []);

  const fitDraftTextarea = useCallback(() => {
    const el = draftTextareaRef.current;
    if (!el) return;
    el.style.overflowY = "hidden";
    el.style.height = "auto";
    const natural = el.scrollHeight;
    const clamped = Math.min(Math.max(natural, 44), DRAFT_TEXTAREA_MAX_HEIGHT_PX);
    el.style.height = `${clamped}px`;
    el.style.overflowY = natural > DRAFT_TEXTAREA_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    fitDraftTextarea();
  }, [draftText, draftParts, fitDraftTextarea]);

  useEffect(() => {
    const onResize = () => fitDraftTextarea();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitDraftTextarea]);

  useEffect(() => {
    void (async () => {
      const s = await window.ds.getSettings();
      setSettings({
        ...defaultSettings,
        apiKey: typeof s.apiKey === "string" ? s.apiKey : "",
        baseUrl: typeof s.baseUrl === "string" ? s.baseUrl : defaultSettings.baseUrl,
        model: typeof s.model === "string" ? s.model : defaultSettings.model,
        systemPrompt: typeof s.systemPrompt === "string" ? s.systemPrompt : "",
        thinkingEnabled:
          typeof s.thinkingEnabled === "boolean" ? s.thinkingEnabled : defaultSettings.thinkingEnabled,
        theme: s.theme === "dark" ? "dark" : "light",
      });
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    void window.ds.setThemeBackground(settings.theme);
  }, [settings.theme]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    queueMicrotask(() => {
      const el = msgScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior });
      else listEndRef.current?.scrollIntoView({ block: "end", behavior });
    });
  }, []);

  const refreshScrollFab = useCallback(() => {
    const el = msgScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < MSG_SCROLL_NEAR_BOTTOM_PX;
    stickToBottomRef.current = nearBottom;
    setShowScrollFab(!nearBottom && messages.length > 0);
  }, [messages]);

  const appendToAssistant = useCallback(
    (field: "content" | "reasoning", chunk: string) => {
      const id = assistantIdRef.current;
      if (!id || !chunk) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.role === "assistant"
            ? { ...m, [field]: m[field] + chunk }
            : m,
        ),
      );
    },
    [],
  );

  const { push: pushContent, flushSync: flushContent } = useStreamBatcher((t) =>
    appendToAssistant("content", t),
  );
  const { push: pushReason, flushSync: flushReason } = useStreamBatcher((t) =>
    appendToAssistant("reasoning", t),
  );

  useEffect(() => {
    const unsubs = [
      window.ds.onChatChunk(({ text }) => pushContent(text)),
      window.ds.onChatReasoning(({ text }) => pushReason(text)),
      window.ds.onChatDone(() => {
        flushContent();
        flushReason();
        setStreaming(false);
        assistantIdRef.current = null;
      }),
      window.ds.onChatAborted(() => {
        flushContent();
        flushReason();
        setStreaming(false);
        const id = assistantIdRef.current;
        assistantIdRef.current = null;
        if (id) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id && m.role === "assistant" ? { ...m, incomplete: true } : m)),
          );
        }
      }),
      window.ds.onChatError(({ message }) => {
        flushContent();
        flushReason();
        setStreaming(false);
        assistantIdRef.current = null;
        setError(message);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [flushContent, flushReason, pushContent, pushReason]);

  useEffect(() => {
    if (!stickToBottomRef.current) {
      refreshScrollFab();
      return;
    }
    scrollToBottom(streaming ? "auto" : "smooth");
    queueMicrotask(() => refreshScrollFab());
  }, [messages, streaming, refreshScrollFab, scrollToBottom]);

  const visionSupported = useMemo(
    () => modelSupportsVision(settings.model.trim() || "deepseek-v4-pro"),
    [settings.model],
  );

  const setDraftText = (text: string) => {
    setDraftParts((prev) => {
      const rest = prev.filter((p) => p.kind !== "text");
      return [{ kind: "text", text }, ...rest];
    });
  };

  const addImages = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length > 0 && !visionSupported) {
      setError(
        "当前模型不支持图片。请在设置中改用 deepseek-v4-pro / deepseek-v4-flash，或使用纯文本对话。",
      );
      return;
    }
    const next: ImagePart[] = [];
    for (const f of arr) {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      next.push({ kind: "image", dataUrl: await resizeDataUrlIfLarge(dataUrl) });
    }
    if (!next.length) return;
    setDraftParts((prev) => [...prev, ...next]);
  };

  const onPasteImages = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    await addImages(files);
  };

  const onDropImages = async (e: React.DragEvent) => {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    e.preventDefault();
    await addImages(imgs);
  };

  const removeDraftImage = (idx: number) => {
    setDraftParts((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearDraft = () => setDraftParts([{ kind: "text", text: "" }]);

  const newChat = () => {
    if (streaming) void window.ds.abortChat();
    const id = uid();
    setSessions((prev) => [{ id, title: "新对话", messages: [], updatedAt: Date.now() }, ...prev]);
    setActiveSessionId(id);
    setError(null);
    clearDraft();
  };

  const selectSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      if (streaming) void window.ds.abortChat();
      setActiveSessionId(id);
      clearDraft();
      setError(null);
    },
    [activeSessionId, streaming],
  );

  const deleteSession = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (streaming) void window.ds.abortChat();
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        if (filtered.length === 0) {
          const nid = uid();
          return [{ id: nid, title: "新对话", messages: [], updatedAt: Date.now() }];
        }
        return filtered;
      });
    },
    [streaming],
  );

  const saveSettings = async (next: AppSettings) => {
    setSettings(next);
    await window.ds.setSettings(next);
  };

  const send = async () => {
    if (!activeSessionId) return;
    setError(null);
    const text = draftText.trim();
    const images = draftParts.filter((p): p is ImagePart => p.kind === "image");
    if (!text && images.length === 0) return;
    if (!settings.apiKey.trim()) {
      setError("请先在设置中填写 API Key");
      setSettingsOpen(true);
      return;
    }
    if (images.length > 0 && !visionSupported) {
      setError(
        "当前所选模型不支持图片（接口只接受纯文本）。请移除图片后发送，或在设置中改用 deepseek-v4-pro / deepseek-v4-flash。",
      );
      return;
    }

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      parts: [...(text ? [{ kind: "text" as const, text }] : []), ...images],
    };
    const asstId = uid();
    assistantIdRef.current = asstId;
    const asst: ChatMessage = {
      id: asstId,
      role: "assistant",
      content: "",
      reasoning: "",
    };

    const base = normalizeBaseUrl(settings.baseUrl);
    const prior = messages.filter((m) => !(m.role === "assistant" && !m.content.trim() && !m.reasoning.trim()));

    const sys = settings.systemPrompt.trim()
      ? ([{ id: uid(), role: "system" as const, content: settings.systemPrompt.trim() }] satisfies ChatMessage[])
      : [];

    const apiMessages = toApiMessages([...sys, ...prior, userMsg], visionSupported);

    stickToBottomRef.current = true;
    setMessages((prev) => [...prev, userMsg, asst]);
    clearDraft();
    setStreaming(true);

    const body: Record<string, unknown> = {
      model: settings.model.trim() || "deepseek-v4-pro",
      messages: apiMessages,
      stream: true,
      thinking: { type: settings.thinkingEnabled ? "enabled" : "disabled" },
    };

    await window.ds.startChat({
      url: `${base}/chat/completions`,
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body,
    });
  };

  const pause = () => {
    void window.ds.abortChat();
  };

  const activeTitle = useMemo(() => {
    const s = sessions.find((x) => x.id === activeSessionId);
    return s?.title?.trim() || "对话";
  }, [sessions, activeSessionId]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  return (
    <div className={`ds-app${sidebarOpen ? "" : " ds-sidebar-collapsed"}`}>
      <aside className="ds-sidebar" aria-hidden={!sidebarOpen}>
        <div className="ds-brand">
          <div className="ds-brand-ident">
            <span className="ds-brand-mark" aria-hidden />
            <span>deepseek</span>
          </div>
          <button
            type="button"
            className="ds-sidebar-toggle ds-sidebar-toggle-side"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="收起侧栏"
            title="收起侧栏"
          >
            <SidebarToggleGlyph />
          </button>
        </div>
        <div className="ds-sidebar-actions">
          <button type="button" className="ds-btn-new" onClick={newChat}>
            <span aria-hidden>＋</span>
            开启新对话
          </button>
        </div>
        <div className="ds-session-scroll">
          {sortedSessions.map((s) => (
            <div
              key={s.id}
              className={`ds-session-item ${s.id === activeSessionId ? "ds-session-item-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => selectSession(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectSession(s.id);
                }
              }}
            >
              <span className="ds-session-title">{s.title}</span>
              <button
                type="button"
                className="ds-session-del"
                onClick={(e) => deleteSession(s.id, e)}
                aria-label="删除会话"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="ds-sidebar-foot">
          <button type="button" onClick={() => setSettingsOpen(true)}>
            设置
          </button>
        </div>
      </aside>

      <div className="ds-main">
        {error ? (
          <div className="ds-error">
            <span>{error}</span>
            <button type="button" className="ds-modal-ghost" onClick={() => setError(null)}>
              关闭
            </button>
          </div>
        ) : null}

        <div className="ds-topbar">
          {!sidebarOpen ? (
            <button
              type="button"
              className="ds-sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="展开侧栏"
              title="展开侧栏"
            >
              <SidebarToggleGlyph />
            </button>
          ) : null}
          <div className="ds-topbar-inner" title={`${activeTitle} · ${settings.model.trim() || "deepseek-v4-pro"}`}>
            <span className="ds-topbar-title">{activeTitle}</span>
            <span className="ds-topbar-sep" aria-hidden>
              ·
            </span>
            <span className="ds-topbar-meta">{settings.model.trim() || "deepseek-v4-pro"}</span>
          </div>
        </div>

        {/* 与下方输入框同级：仅本区域滚动，底部整块留给输入 */}
        <div className="ds-msg-scroll" ref={msgScrollRef} onScroll={refreshScrollFab}>
          <div className="ds-msg-inner">
            {messages.length === 0 ? (
              <div className="ds-empty">开始对话。可在左侧「设置」中配置 API Key、模型与系统提示词。</div>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} message={m} />)
            )}
            <div ref={listEndRef} />
          </div>
          {showScrollFab ? (
            <button
              type="button"
              className="ds-scroll-fab"
              onClick={() => {
                stickToBottomRef.current = true;
                scrollToBottom("auto");
                queueMicrotask(() => refreshScrollFab());
              }}
              aria-label="回到底部"
            >
              ↓
            </button>
          ) : null}
        </div>

        <div className="ds-input-shell">
          <div className="ds-input-card" onDragOver={(e) => e.preventDefault()} onDrop={onDropImages}>
            {draftParts.some((p) => p.kind === "image") ? (
              <div className="ds-thumbs">
                {draftParts.map((p, i) =>
                  p.kind === "image" ? (
                    <div key={i} className="ds-thumb-wrap">
                      <img src={p.dataUrl} alt="" className="ds-thumb" />
                      <button
                        type="button"
                        className="ds-thumb-x"
                        onClick={() => removeDraftImage(i)}
                        aria-label="移除图片"
                      >
                        ×
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            ) : null}

            <textarea
              ref={draftTextareaRef}
              className="ds-input-ta"
              placeholder="给 DeepSeek 发送消息"
              value={draftText}
              onChange={(e) => {
                setDraftText(e.target.value);
                requestAnimationFrame(() => fitDraftTextarea());
              }}
              onPaste={onPasteImages}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              disabled={streaming}
            />
            <div className="ds-input-toolbar">
              <button
                type="button"
                className="ds-icon-btn"
                onClick={() => fileInputRef.current?.click()}
                aria-label="添加图片"
                disabled={streaming || !visionSupported}
                title={
                  visionSupported
                    ? "添加图片"
                    : "当前模型不支持图片，请改用 deepseek-v4-pro / deepseek-v4-flash"
                }
              >
                📎
              </button>
              <button
                type="button"
                className={streaming ? "ds-send-round ds-send-stop" : "ds-send-round"}
                onClick={streaming ? pause : () => void send()}
                aria-label={streaming ? "暂停" : "发送"}
              >
                {streaming ? "■" : "↑"}
              </button>
            </div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void addImages(e.target.files || []);
            e.target.value = "";
          }}
        />

        {settingsOpen ? (
          <SettingsModal
            value={settings}
            onSave={async (v) => {
              await saveSettings(v);
              setSettingsOpen(false);
            }}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({ message: m }: { message: ChatMessage }) {
  if (m.role === "system") return null;
  if (m.role === "user") {
    return (
      <div className="ds-user-row">
        <div className="ds-user-bubble">
          {m.parts.map((p, i) =>
            p.kind === "image" ? (
              <img key={i} src={p.dataUrl} alt="" />
            ) : (
              <div key={i} className="ds-user-text">
                {p.text}
              </div>
            ),
          )}
        </div>
      </div>
    );
  }

  const showReason = m.reasoning.trim().length > 0;
  const pauseSuffix =
    m.incomplete && m.content.trim()
      ? "\n\n**[已暂停]**"
      : !m.content.trim() && m.incomplete
        ? "（已暂停）"
        : "";
  const answerMd = (m.content || "") + pauseSuffix;

  return (
    <article className="ds-asst-block">
      <div className="ds-asst-inner">
        {showReason ? (
          <details className="ds-reason-wrap" open>
            <summary>
              <span className="ds-reason-summary-text">思考过程</span>
              <span className="ds-reason-chevron" aria-hidden="true">
                ▼
              </span>
            </summary>
            <div className="ds-reason-body">
              <MarkdownContent markdown={m.reasoning} className="ds-markdown-reason" />
            </div>
          </details>
        ) : null}
        {answerMd.trim() ? <MarkdownContent markdown={answerMd} /> : null}
      </div>
    </article>
  );
}

function SettingsModal({
  value,
  onSave,
  onClose,
}: {
  value: AppSettings;
  onSave: (v: AppSettings) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div className="ds-modal-backdrop" onMouseDown={onClose}>
      <div className="ds-modal-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="ds-modal-h2">设置</h2>
        <label className="ds-modal-label">
          API Key
          <input
            className="ds-modal-field"
            type="password"
            autoComplete="off"
            value={local.apiKey}
            onChange={(e) => setLocal({ ...local, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </label>
        <label className="ds-modal-label">
          API Base（默认 DeepSeek 官方）
          <input
            className="ds-modal-field"
            value={local.baseUrl}
            onChange={(e) => setLocal({ ...local, baseUrl: e.target.value })}
            placeholder="https://api.deepseek.com/v1"
          />
        </label>
        <label className="ds-modal-label">
          模型
          <input
            className="ds-modal-field"
            value={local.model}
            onChange={(e) => setLocal({ ...local, model: e.target.value })}
            placeholder="deepseek-v4-pro"
          />
        </label>
        <label className="ds-modal-label">
          系统提示词（可选）
          <textarea
            className="ds-modal-field ds-modal-textarea"
            value={local.systemPrompt}
            onChange={(e) => setLocal({ ...local, systemPrompt: e.target.value })}
          />
        </label>
        <label className="ds-modal-check">
          <input
            type="checkbox"
            checked={local.thinkingEnabled}
            onChange={(e) => setLocal({ ...local, thinkingEnabled: e.target.checked })}
          />
          启用思考模式（thinking）
        </label>
        <fieldset className="ds-modal-fieldset">
          <legend className="ds-modal-legend">外观</legend>
          <label className="ds-modal-radio">
            <input
              type="radio"
              name="theme"
              checked={local.theme === "light"}
              onChange={() => setLocal({ ...local, theme: "light" })}
            />
            浅色（侧栏灰色，对话区白色）
          </label>
          <label className="ds-modal-radio">
            <input
              type="radio"
              name="theme"
              checked={local.theme === "dark"}
              onChange={() => setLocal({ ...local, theme: "dark" })}
            />
            深色（黑底白字）
          </label>
        </fieldset>
        <div className="ds-modal-actions">
          <button type="button" className="ds-btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="ds-btn-primary" onClick={() => onSave(local)}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
