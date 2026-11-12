/** The four stages of using any tool here, in the order you use them. */
export type Tab = "setup" | "plan" | "simulate" | "protocol";

export const TAB_LABELS: Record<Tab, string> = {
  setup: "Set up",
  plan: "Plan",
  simulate: "Simulate",
  protocol: "Protocol",
};

export const TABS: Tab[] = ["setup", "plan", "simulate", "protocol"];
