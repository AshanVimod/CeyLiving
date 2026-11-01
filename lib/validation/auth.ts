import { z } from "zod";

// SEC-A3 / AU-01: what the sign-in forms may send. Emails are trimmed and lowercased (users.email is stored
// lowercase); passwords are never trimmed or changed.

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Enter a valid email address." }));

/** AU-01: at least 10 characters; Better Auth also refuses passwords seen in data breaches. */
export const newPassword = z
  .string()
  .min(10, { error: "Use at least 10 characters." })
  .max(128, { error: "Use at most 128 characters." });

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }).max(128),
  next: z.string().max(500).optional(),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2, { error: "Enter your name." }).max(80),
  email,
  password: newPassword,
  next: z.string().max(500).optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(500),
  password: newPassword,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { error: "Enter your current password." }).max(128),
  password: newPassword,
});
