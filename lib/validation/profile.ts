import { z } from "zod";
import { district, optionalPhone, optionalText, phone, text } from "./common";

export const profileSchema = z.object({
  name: text("your name", 2, 80),
  phone: optionalPhone,
});

export const addressSchema = z.object({
  label: text("a label", 1, 30),
  recipientName: text("the recipient's name", 2, 80),
  line1: text("the first address line", 3, 120),
  line2: optionalText("the second address line", 120),
  city: text("the city", 2, 60),
  district,
  postalCode: optionalText("the postal code", 10),
  phone,
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type AddressInput = z.infer<typeof addressSchema>;
