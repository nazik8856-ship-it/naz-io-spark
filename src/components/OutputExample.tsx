import { Lightbulb, BarChart3, DollarSign, ListChecks } from "lucide-react";

const outputs = [
  {
    icon: Lightbulb,
    title: "Business Idea",
    content: "AI-powered resume builder that matches job descriptions and optimizes keywords for ATS systems.",
  },
  {
    icon: BarChart3,
    title: "Market Summary",
    content: "$12B recruitment tech market growing at 14% CAGR. 73% of resumes are rejected by ATS before human review.",
  },
  {
    icon: DollarSign,
    title: "Monetization Plan",
    content: "Freemium model — free basic scans, $19/mo Pro with unlimited optimizations, $49/mo Agency tier.",
  },
  {
    icon: ListChecks,
    title: "Action Steps",
    content: "1. Validate with 50 job seekers  2. Build MVP with GPT API  3. Launch on Product Hunt  4. Partner with job boards.",
  },
];

const OutputExample = () => {
  return (
    <section id="output-example" className="py-24 relative">
      <div className="container mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-glow mb-6">
            <span className="text-sm text-muted-foreground">See What You Get</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Output <span className="text-gradient">Example</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Here's a sample of what NazAI generates from a single idea
          </p>
        </div>

        {/* Output Cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {outputs.map((item) => (
            <div
              key={item.title}
              className="p-6 rounded-2xl glass border-glow hover:glow-soft transition-all duration-300"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-foreground">{item.title}</h3>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">{item.content}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default OutputExample;
