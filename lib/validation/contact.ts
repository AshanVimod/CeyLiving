// RULE-Q4: questions, answers, reviews and replies must not carry contact details, so deals stay on the platform.

const EMAIL = /[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9.-]+\s*(\.|\(dot\)|\[dot\])\s*[a-z]{2,}/i;
const URL_LIKE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|lk|net|org|io|co|me|shop|store|info|biz)\b/i;
// 9+ digits, allowing spaces, dots, dashes and brackets between them (+94 77 123 4567, 077-123-4567).
const PHONE = /(\+?\d[\s().-]*){9,}/;

export type ContactKind = "email" | "link" | "phone";

export function findContactDetails(text: string): ContactKind | undefined {
  if (EMAIL.test(text)) return "email";
  if (URL_LIKE.test(text)) return "link";
  if (PHONE.test(text)) return "phone";
  return undefined;
}

export const CONTACT_DETAILS_MESSAGE =
  "Remove email addresses, phone numbers and links. To keep buyers and makers safe, all conversations stay on CeyLiving.";
