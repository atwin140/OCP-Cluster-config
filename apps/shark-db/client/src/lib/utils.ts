import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format ISO date string as "Apr 11, 2026 · 07:38 AM" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Map conservation status to a CSS class */
export function statusClass(status: string): string {
  const map: Record<string, string> = {
    "Least Concern":          "status-lc",
    "Near Threatened":        "status-nt",
    "Vulnerable":             "status-vu",
    "Endangered":             "status-en",
    "Critically Endangered":  "status-cr",
    "Data Deficient":         "status-dd",
    "Not Evaluated":          "status-ne",
  };
  return map[status] ?? "status-ne";
}

export const CONSERVATION_STATUSES = [
  "Least Concern",
  "Near Threatened",
  "Vulnerable",
  "Endangered",
  "Critically Endangered",
  "Data Deficient",
  "Not Evaluated",
] as const;

export const HABITATS = [
  "Coastal",
  "Open ocean",
  "Deep water",
  "Coral reefs",
  "Arctic / cold water",
  "Freshwater / estuaries",
  "Tropical",
  "Temperate",
] as const;
