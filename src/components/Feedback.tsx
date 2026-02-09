import { Star } from "lucide-react";

const Feedback = () => {
  const testimonials = [
    {
      name: "Sarah Chen",
      role: "Founder, TechStart",
      content: "NazAI helped me validate my business idea in minutes. The AI insights are incredibly accurate.",
      rating: 5,
    },
    {
      name: "Marcus Johnson",
      role: "CEO, GrowthLabs",
      content: "The best business ideation tool I've used. It's like having a strategic advisor 24/7.",
      rating: 5,
    },
    {
      name: "Elena Rodriguez",
      role: "Entrepreneur",
      content: "From concept to execution plan in one session. NazAI is a game-changer for startups.",
      rating: 5,
    },
  ];

  return (
    <section className="py-20 relative">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            Trusted by <span className="text-gradient">Innovators</span>
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            See what entrepreneurs are saying about NazAI
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="p-6 rounded-2xl glass border-glow hover:scale-[1.02] transition-transform duration-300"
            >
              <div className="flex gap-1 mb-4">
                {Array.from({ length: testimonial.rating }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-muted-foreground text-sm mb-4 leading-relaxed">
                "{testimonial.content}"
              </p>
              <div>
                <p className="font-semibold text-foreground text-sm">{testimonial.name}</p>
                <p className="text-xs text-muted-foreground">{testimonial.role}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Feedback;
