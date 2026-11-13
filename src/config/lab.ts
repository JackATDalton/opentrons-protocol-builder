/** Public defaults: notifications are opt-in and configured in the app. */
import type { NotifyConfig } from "../core/emit";

export const LAB_SLACK_WEBHOOK_URL =
  "";

/**
 * Notification settings for a run. A blank or missing webhook falls back to
 * the lab's, so a lab protocol always posts; `preamble` applies the same
 * fallback for code that bypasses this function.
 */
export function labNotify(slackUserId?: string, webhookUrl = ""): NotifyConfig {
  return {
    slackWebhookUrl: webhookUrl.trim() || LAB_SLACK_WEBHOOK_URL.trim() || undefined,
    slackUserId: slackUserId || undefined,
  };
}

/** Accept "U0123ABCD", "@U0123ABCD" or "<@U0123ABCD>"; blank means no tag. */
export function normaliseSlackUserId(raw: string): string {
  const id = raw.trim().replace(/^</, "").replace(/>$/, "").replace(/^@/, "").toUpperCase();
  if (id && !/^[UW][A-Z0-9]{6,}$/.test(id)) {
    throw new Error(`"${raw}" is not a Slack member ID (expected e.g. U0123ABCD — Profile → ⋯ → Copy member ID).`);
  }
  return id;
}
