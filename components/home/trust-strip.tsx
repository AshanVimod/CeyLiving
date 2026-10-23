import { HandIcon, ReturnIcon, ShieldIcon, TruckIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/section-heading";

/** Home page: only claims the platform actually enforces. */
export function TrustStrip() {
  return (
    <section aria-label="How CeyLiving works" className="mt-24 border-y border-line bg-paper-raised">
      <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: HandIcon, title: "Every shop reviewed", text: "We check each maker before their shop goes live." },
          {
            icon: ShieldIcon,
            title: "Secure payment",
            text: "Pay by card through PayHere. We never see your card details.",
          },
          {
            icon: TruckIcon,
            title: "Delivery fee shown upfront",
            text: "One flat fee per shop, visible before you pay.",
          },
          {
            icon: ReturnIcon,
            title: "Return policy on every listing",
            text: "Each maker's terms are on the product page.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sage text-forest">
              <Icon size={22} />
            </span>
            <div>
              <h3 className="font-sans text-base font-semibold">{title}</h3>
              <p className="mt-0.5 text-sm text-ink-soft">{text}</p>
            </div>
          </div>
        ))}
      </Container>
    </section>
  );
}
