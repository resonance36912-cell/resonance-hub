import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { recordVisit } from "@/lib/visits.functions";

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const KEY = "resonance_sid";
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid =
        (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  } catch {
    return "";
  }
}

export function VisitTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const record = useServerFn(recordVisit);
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Skip admin pages from visit counts to keep stats focused on public traffic.
    if (pathname.startsWith("/admin")) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    const sid = getOrCreateSessionId();
    record({
      data: {
        path: pathname,
        referrer: document.referrer || null,
        session_id: sid || null,
      },
    }).catch(() => {
      /* silent */
    });
  }, [pathname, record]);

  return null;
}
