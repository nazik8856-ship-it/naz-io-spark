import { Brain, Zap, Shield, BarChart3, Code2, Globe } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Advanced AI Models",
    description:
      "Access state-of-the-art language models trained on diverse datasets for superior performance.",
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description:
      "Experience sub-second response times with our optimized infrastructure and edge computing.",
  },
  {
    icon: Shield,
    title: "Enterprise Security",
    description:
      "Bank-grade encryption and compliance with SOC 2, GDPR, and HIPAA standards.",
  },
  {
    icon: BarChart3,
    title: "Deep Analytics",
    description:
      "Gain actionable insights with comprehensive dashboards and custom reporting tools.",
  },
  {
    icon: Code2,
    title: "Developer First",
    description:
      "Robust APIs, SDKs, and documentation designed for seamless integration.",
  },
  {
    icon: Globe,
    title: "Global Scale",
    description:
      "Deploy across 50+ regions with automatic scaling and 99.99% uptime guarantee.",
  },
];

const Features = () => {
  return (
    <section id="features" className="py-24 relative">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-card/50 to-transparent" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Powerful <span className="text-gradient">Features</span>
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            From idea to live product — NazAI handles validation, planning, building, and deployment.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className="group p-6 rounded-2xl glass hover:border-primary/30 transition-all duration-300 hover:glow-soft"
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features;
