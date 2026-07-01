/**
 * TRAI DLT-approved templates (from DLT-Templates_639031439306079951.xls).
 * Use OTP-only template for login — not the password-reset variants.
 */
export const DLT_SENDER_ID = "PVANAM";

export const DLT_TEMPLATES = {
  /** eCommerce OTP ORG Final — single {#var#} = OTP */
  otp: {
    name: "eCommerce OTP ORG Final",
    templateId: "1207162444616325184",
    senderId: DLT_SENDER_ID,
    content:
      "Your secret One Time Password (OTP) for creating eCommerce account {#var#}. Please do not share this with anyone. PVANAM",
  },
  /** shopping information — {#var#} = order ref, {#var#} = storefront URL */
  orderConfirm: {
    name: "shopping information",
    templateId: "1207173202559344872",
    senderId: DLT_SENDER_ID,
    content:
      "Thanks for shopping. Your reference ID is {#var#}. Please visit our site again soon from {#var#}. PRAKRUTHIVANAM",
  },
} as const;

/** Replace DLT {#var#} placeholders in registration order. */
export const applyDltVariables = (template: string, values: string[]): string => {
  let i = 0;
  return template.replace(/\{#var#\}/g, () => values[i++] ?? "");
};

/** Legacy ERP settings may use {otp}; normalize to a single var for DLT. */
export const otpTemplateFromLegacy = (text: string): string =>
  text.includes("{otp}") ? text.replace(/\{otp\}/g, "{#var#}") : text;
