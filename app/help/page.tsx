import type { Metadata } from "next";
import { DemoForm, Field, TextArea } from "@/components/forms/fields";
import { Container } from "@/components/ui/section-heading";
import { FREE_SHIPPING_THRESHOLD_CENTS, SHIPPING_FEE_PER_SHOP_CENTS } from "@/lib/config";
import { formatLkr } from "@/lib/format";

export const metadata: Metadata = {
  title: "Help",
  description: "Delivery, returns, payments and how to contact CeyLiving.",
};

const sections = [
  {
    id: "delivery",
    title: "Delivery",
    faqs: [
      {
        q: "How much is delivery?",
        a: `Each shop charges a flat ${formatLkr(SHIPPING_FEE_PER_SHOP_CENTS)} per order, free when your order from that shop is over ${formatLkr(FREE_SHIPPING_THRESHOLD_CENTS)}. If you buy from two shops, you pay two delivery fees, because each maker ships separately. You see the total before you pay.`,
      },
      {
        q: "How long does it take?",
        a: "Ready-to-ship pieces usually arrive in 3 to 6 days. Made-to-order pieces show their processing time on the listing; delivery starts after that.",
      },
      {
        q: "Do you ship outside Sri Lanka?",
        a: "Not yet. International delivery is planned once the island-wide service is running smoothly.",
      },
    ],
  },
  {
    id: "returns",
    title: "Returns",
    faqs: [
      {
        q: "Can I return something?",
        a: "Each maker sets their own return policy, shown on every product page. Most accept returns within 14 days if the piece is unused.",
      },
      {
        q: "What if it arrives damaged?",
        a: "Photograph it and contact us within 3 days of delivery. We'll arrange a replacement or a full refund.",
      },
      {
        q: "Can I return a personalized item?",
        a: "Only if it arrives damaged or differs from what you asked for, since it was made for you.",
      },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    faqs: [
      {
        q: "How do I pay?",
        a: "By card or mobile wallet through PayHere, a Sri Lankan payment gateway. You enter your card details on PayHere's page, never on ours.",
      },
      {
        q: "When is my card charged?",
        a: "When you place the order. If a maker can't accept it within 3 days, you're refunded automatically.",
      },
    ],
  },
  {
    id: "selling",
    title: "Selling on CeyLiving",
    faqs: [
      {
        q: "How do I open a shop?",
        a: "Apply from the Become a seller page. We review every application, usually within five working days.",
      },
      { q: "When do I get paid?", a: "Weekly, to your bank account, 7 days after the customer receives their order." },
    ],
  },
];

export default function HelpPage() {
  return (
    <Container className="pt-10">
      <h1 className="text-[2.5rem] sm:text-[3.2rem]">Help</h1>
      <p className="mt-3 max-w-xl text-lg text-ink-soft">
        Answers about delivery, returns and payments. Still stuck? Message us at the bottom of this page.
      </p>

      <nav aria-label="Help topics" className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {[...sections, { id: "contact", title: "Contact us" }].map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex min-h-10 items-center rounded-full border border-line bg-paper-raised px-4 text-sm hover:border-ink-soft"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-12 max-w-3xl space-y-14">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-40">
            <h2 id={`${s.id}-h`} className="text-[1.75rem]">
              {s.title}
            </h2>
            <div className="mt-4 border-t border-line">
              {s.faqs.map((f) => (
                <details key={f.q} className="group border-b border-line">
                  <summary className="flex min-h-14 list-none items-center justify-between gap-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span className="relative size-4 shrink-0" aria-hidden="true">
                      <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-ink" />
                      <span className="absolute inset-y-0 left-1/2 w-[1.5px] -translate-x-1/2 bg-ink transition-transform duration-300 group-open:rotate-90 group-open:opacity-0" />
                    </span>
                  </summary>
                  <p className="max-w-prose pb-5 text-ink-soft">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <section id="contact" aria-labelledby="contact-h" className="scroll-mt-40">
          <h2 id="contact-h" className="text-[1.75rem]">
            Contact us
          </h2>
          <p className="mt-2 mb-6 text-ink-soft">We reply within two working days.</p>
          <DemoForm
            submitLabel="Send message"
            successTitle="Message sent"
            successText="Thanks for writing. We'll reply to your email within two working days."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Your name" name="name" autoComplete="name" required />
              <Field label="Email" name="email" type="email" autoComplete="email" required />
            </div>
            <Field label="Order number" name="order" helper="Optional. For example CM-2026-000123" />
            <TextArea label="Message" name="message" required maxLength={2000} />
          </DemoForm>
        </section>
      </div>
    </Container>
  );
}
