import { ArrowRight } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Describe Your Idea",
    description:
      "Tell NazAI about your AI Agent concept, target market, and unique value proposition in simple terms.",
  },
  {
    number: "02",
    title: "AI Validates & Plans",
    description:
      "NazAI analyzes your idea, validates market fit, and generates a comprehensive AI Agent plan with actionable steps.",
  },
  {
    number: "03",
    title: "Deploy & Launch",
    description:
      "Get a live, deployed product with landing page, documentation, and everything needed to start selling.",
  },
];

const HowItWorks = () => {
  return (
    <section id="how-it-works" className="py-24 relative">
      <div className="container mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            How It <span className="text-gradient">Works</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Get started in minutes with our streamlined onboarding process
          </p>
        </div>

        {/* Steps */}
        <div className="max-w-4xl mx-auto">
          {steps.map((step, index) => (
            <div key={step.number} className="relative">
              <div className="flex items-start gap-6 md:gap-10">
                {/* Step Number */}
                <div className="flex-shrink-0">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                    <span className="text-2xl font-bold text-gradient">
                      {step.number}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 pb-12">
                  <h3 className="text-xl md:text-2xl font-semibold mb-3 text-foreground">
                    {step.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div className="absolute left-8 top-20 w-px h-12 bg-gradient-to-b from-primary/50 to-transparent" />
              )}
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <a
            href="https://docs.nazai.net"
            className="inline-flex items-center gap-2 text-primary hover:text-primary/80 font-medium transition-colors group"
          >
            View detailed documentation
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
