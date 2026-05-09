import React, { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import sql from "highlight.js/lib/languages/sql";
import markdown from "highlight.js/lib/languages/markdown";
import cpp from "highlight.js/lib/languages/cpp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import yaml from "highlight.js/lib/languages/yaml";

import "highlight.js/styles/github.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("jsx", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("zsh", bash);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

function textContent(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "object" && "props" in node) {
    const el = node as { props?: { children?: React.ReactNode } };
    return textContent(el.props?.children);
  }
  return "";
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeLang(raw: string) {
  const m: Record<string, string> = {
    ts: "typescript",
    js: "javascript",
    jsx: "javascript",
    tsx: "typescript",
    py: "python",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    vue: "xml",
    rs: "rust",
  };
  const k = raw.toLowerCase();
  return m[k] || k;
}

function highlightToHtml(code: string, lang: string) {
  const l = normalizeLang(lang);
  if (l === "text" || l === "plaintext" || l === "txt") {
    return escapeHtml(code);
  }
  try {
    if (hljs.getLanguage(l)) return hljs.highlight(code, { language: l }).value;
  } catch {
    /* fall through */
  }
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function extForLang(lang: string) {
  const l = normalizeLang(lang);
  const map: Record<string, string> = {
    typescript: "ts",
    javascript: "js",
    python: "py",
    bash: "sh",
    markdown: "md",
    yaml: "yml",
    rust: "rs",
    go: "go",
    cpp: "cpp",
    c: "c",
    json: "json",
    sql: "sql",
    css: "css",
    xml: "html",
  };
  return map[l] || l || "txt";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function findFenceCodeEl(children: React.ReactNode) {
  const arr = React.Children.toArray(children);
  const byLangClass = arr.find((c) => {
    if (!React.isValidElement(c)) return false;
    const cls = String((c.props as { className?: string }).className || "");
    return /language-[\w-]+/.test(cls);
  });
  if (byLangClass && React.isValidElement(byLangClass)) {
    return byLangClass as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
  }
  const intrinsic = arr.find((c) => React.isValidElement(c) && c.type === "code");
  if (intrinsic && React.isValidElement(intrinsic)) {
    return intrinsic as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
  }
  const firstEl = arr.find((c) => React.isValidElement(c));
  return firstEl && React.isValidElement(firstEl)
    ? (firstEl as React.ReactElement<{ className?: string; children?: React.ReactNode }>)
    : undefined;
}

function PreBlock({ children }: { children?: React.ReactNode }) {
  const codeEl = useMemo(() => findFenceCodeEl(children), [children]);

  const className = codeEl?.props.className;
  const match = /language-([\w-]+)/.exec(className || "");
  const lang = match?.[1] || "text";
  const raw = useMemo(
    () => textContent(codeEl?.props.children).replace(/\n$/, ""),
    [codeEl, children],
  );
  const html = useMemo(() => highlightToHtml(raw, lang), [raw, lang]);
  const filename = `snippet.${extForLang(lang)}`;

  return (
    <div className="ds-code-wrap">
      <div className="ds-code-toolbar">
        <span className="ds-code-lang">{lang}</span>
        <div className="ds-code-actions">
          <button type="button" className="ds-code-btn" onClick={() => void copyText(raw)}>
            复制
          </button>
          <button type="button" className="ds-code-btn" onClick={() => downloadText(filename, raw)}>
            下载
          </button>
        </div>
      </div>
      <pre className="ds-code-pre">
        <code className={`hljs ${className || ""}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

const mdComponents: Partial<Components> = {
  pre({ children }) {
    return <PreBlock>{children}</PreBlock>;
  },
  code({ className, children, ...props }) {
    const isFence = /language-[\w-]+/.test(className || "");
    if (isFence) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={`ds-md-inline ${className || ""}`.trim()} {...props}>
        {children}
      </code>
    );
  },
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

export function MarkdownContent({ markdown, className }: { markdown: string; className?: string }) {
  return (
    <div className={className ? `ds-markdown ${className}` : "ds-markdown"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
