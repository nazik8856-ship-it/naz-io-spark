import { Star, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const Feedback = () => {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) return;
    
    setIsSubmitting(true);
    // Simulate submission
    setTimeout(() => {
      toast({
        title: "Thank you for your feedback!",
        description: "We appreciate you taking the time to share your thoughts.",
      });
      setName("");
      setMessage("");
      setIsSubmitting(false);
    }, 1000);
  };

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
        {/* Testimonials */}
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            Trusted by <span className="text-gradient">Innovators</span>
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            See what entrepreneurs are saying about NazAI
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-16">
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

        {/* Visitor Feedback Form */}
        <div className="max-w-lg mx-auto">
          <div className="text-center mb-6">
            <h3 className="text-xl font-semibold mb-2">Share Your Thoughts</h3>
            <p className="text-sm text-muted-foreground">
              We'd love to hear from you
            </p>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 rounded-2xl glass border-glow space-y-4">
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background/50 border-border/50"
            />
            <Textarea
              placeholder="Your feedback..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="bg-background/50 border-border/50 min-h-[100px] resize-none"
            />
            <Button 
              type="submit" 
              className="w-full"
              disabled={isSubmitting || !name.trim() || !message.trim()}
            >
              {isSubmitting ? "Sending..." : "Send Feedback"}
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
};

export default Feedback;
