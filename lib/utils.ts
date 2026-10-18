import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// NEXT_PUBLIC_APP_URL is set with a trailing slash on Vercel and without on
// Railway; pasting a path onto it produced "//api/webhooks/gmail", which failed
// every Pub/Sub token's audience check.
export function appUrl(path: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}${path}`
}
