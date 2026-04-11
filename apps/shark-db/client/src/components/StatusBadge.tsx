/**
 * StatusBadge — shows conservation status with appropriate colour coding.
 */
import { statusClass } from "@/lib/utils";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(status)}`}
      data-testid={`status-badge-${status.replace(/\s/g, "-").toLowerCase()}`}
    >
      {status}
    </span>
  );
}
