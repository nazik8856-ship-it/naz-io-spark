import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const pricingTiers = [
  {
    name: "Free",
    price: 0,
    description: "Perfect for getting started",
    features: [
      "1 project",
      "AI idea validation",
      "Basic business plan",
      "Community support",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Pro",
    price: 29,
    description: "For serious builders",
    features: [
      "Unlimited projects",
      "Full business plan",
      "Landing page generation",
      "Custom domain support",
      "Email support",
      "Advanced analytics",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Team",
    price: 99,
    description: "For growing teams",
    features: [
      "Everything in Pro",
      "Team collaboration",
      "Priority support",
      "API access",
      "Custom integrations",
      "Dedicated account manager",
    ],
    cta: "Contact Sales",
    highlighted: false,
  },
];

const Pricing = () => {
  return (
    <section id="pricing" className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/30 to-transparent" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Simple, Transparent <span className="text-gradient">Pricing</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Choose the perfect plan for your business needs. Always flexible, no long-term contracts.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {pricingTiers.map((tier, index) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl p-8 transition-all duration-300 ${
                tier.highlighted
                  ? "glass border-primary/50 shadow-lg scale-105 md:scale-100"
                  : "glass hover:border-primary/30"
              }`}
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              {/* Highlighted Badge */}
              {tier.highlighted && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                  <span className="inline-block px-4 py-1 rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                    Most Popular
                  </span>
                </div>
              )}

              {/* Tier Name */}
              <h3 className="text-2xl font-bold mb-2 text-foreground">
                {tier.name}
              </h3>
              <p className="text-muted-foreground text-sm mb-6">
                {tier.description}
              </p>

              {/* Price */}
              <div className="mb-8">
                <span className="text-5xl font-bold text-foreground">
                  ${tier.price}
                </span>
                <span className="text-muted-foreground ml-2">/month</span>
              </div>

              {/* CTA Button */}
              <Button
                variant={tier.highlighted ? "default" : "outline"}
                size="lg"
                className="w-full mb-8"
              >
                {tier.cta}
              </Button>

              {/* Features List */}
              <div className="space-y-4">
                {tier.features.map((feature) => (
                  <div key={feature} className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-primary flex-shrink-0" />
                    <span className="text-foreground">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* FAQ or Additional Info */}
        <div className="text-center mt-16">
          <p className="text-muted-foreground mb-4">
            All plans include a 14-day free trial. No credit card required.
          </p>
          <a
            href="#"
            className="text-primary hover:text-primary/80 font-medium transition-colors"
          >
            View detailed comparison →
          </a>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
