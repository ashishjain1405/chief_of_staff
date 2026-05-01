"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const BASE_STYLES = `
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px; line-height: 1.6;
      color: #1a1a1a; background: transparent;
      word-break: break-word;
    }
    body { padding: 0; }
    a { color: #2563eb; }
    img { max-width: 100%; height: auto; }
    table { border-collapse: collapse; max-width: 100%; }
    td, th { padding: 4px 8px; }
    pre { white-space: pre-wrap; font-family: inherit; }
    blockquote {
      border-left: 3px solid #d1d5db;
      margin: 8px 0; padding-left: 12px;
      color: #6b7280;
    }
  </style>
`;

function buildSrcdoc(html: string, allowImages: boolean): string {
  const csp = allowImages
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https:;">`
    : `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">`;
  return `<!DOCTYPE html><html><head>${csp}${BASE_STYLES}</head><body>${html}</body></html>`;
}

interface Props {
  html: string | null;
  plainText: string;
}

export default function EmailBody({ html, plainText }: Props) {
  const [allowImages, setAllowImages] = useState(false);
  const [height, setHeight] = useState(400);

  if (!html) {
    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground font-sans">
        {plainText || "No body content"}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!allowImages && (
        <div className="flex items-center justify-between px-3 py-2 bg-muted/60 rounded-md text-xs text-muted-foreground">
          <span>External images are blocked</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2"
            onClick={() => setAllowImages(true)}
          >
            Load images
          </Button>
        </div>
      )}
      <iframe
        key={allowImages ? "images-on" : "images-off"}
        srcDoc={buildSrcdoc(html, allowImages)}
        sandbox="allow-same-origin"
        className="w-full border-0 rounded"
        style={{ height }}
        onLoad={(e) => {
          const iframe = e.currentTarget;
          const body = iframe.contentDocument?.body;
          if (body) {
            setHeight(Math.max(200, body.scrollHeight + 24));
          }
        }}
      />
    </div>
  );
}
