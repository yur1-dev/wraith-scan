// Firebase Cloud Messaging (native Android push). Needs env FIREBASE_SERVICE_ACCOUNT = the service-account JSON.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";

export interface FcmMsg { title: string; body: string; url: string; tag: string }
/** ok = Firebase accepted it · dead = this phone's token no longer exists (drop it) · error = could not send, `code` says why */
export type FcmResult = { status: "ok" } | { status: "dead" } | { status: "error"; code: string };

let ready: boolean | null = null;
export function fcmConfigured(): boolean {
  if (ready !== null) return ready;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { ready = false; return false; }
  try {
    const sa = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
    if (!getApps().length) {
      initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key).replace(/\\n/g, "\n") }) });
    }
    ready = true;
  } catch (e) {
    console.error("[fcm] bad FIREBASE_SERVICE_ACCOUNT", e);
    ready = false;
  }
  return ready;
}

const DEAD = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
const TRANSIENT = new Set(["messaging/internal-error", "messaging/server-unavailable", "messaging/unknown-error"]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends one alert to one phone. The message carries BOTH a ready-made notification (Android can show it by itself, with the
 * Wraith icon and the "Wraith alerts" channel, even when the app is not running) and the same text as data (so the app can
 * still draw it itself while it is open). A short hiccup on Google's side is retried once.
 */
export async function sendFcm(token: string, msg: FcmMsg): Promise<FcmResult> {
  if (!fcmConfigured()) return { status: "error", code: "fcm-not-configured" };
  const message: Message = {
    token,
    notification: { title: msg.title, body: msg.body },
    data: { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag },
    android: {
      priority: "high",
      ttl: 3600 * 1000,
      notification: {
        channelId: "wraith_alerts",
        icon: "ic_notification_icon",
        color: "#FF7B3D",
        tag: msg.tag,
        priority: "high",
        defaultSound: true,
        visibility: "public",
      },
    },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await getMessaging().send(message);
      return { status: "ok" };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "unknown";
      if (DEAD.has(code)) return { status: "dead" };
      if (attempt === 0 && (TRANSIENT.has(code) || code.startsWith("app/"))) { await sleep(600); continue; }
      console.error("[fcm] send failed", code);
      return { status: "error", code };
    }
  }
}
