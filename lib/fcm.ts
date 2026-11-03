// Firebase Cloud Messaging (native Android push). Needs env FIREBASE_SERVICE_ACCOUNT = the service-account JSON.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

export interface FcmMsg { title: string; body: string; url: string; tag: string }

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

/** returns false when the token is dead and should be removed */
export async function sendFcm(token: string, msg: FcmMsg): Promise<boolean> {
  if (!fcmConfigured()) return true;
  try {
    await getMessaging().send({
      token,
      data: { title: msg.title, body: msg.body, url: msg.url, tag: msg.tag },
      android: { priority: "high", ttl: 3600 * 1000 },
    });
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") return false;
    console.error("[fcm] send failed", code || e);
    return true;
  }
}
