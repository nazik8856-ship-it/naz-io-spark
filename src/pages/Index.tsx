import React from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Feedback from "@/components/Feedback";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

const Index = () => {
  const [showToast, setShowToast] = React.useState(false);
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Hero onStart={() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false),(3000);
      }} />
      <Features />
      <HowItWorks />
      <Feedback />
      <CTA />
      <Footer />
      {showToast && <div className="success-toast">Project launched successfully! 🚀</div>};
    </div>
  );
};

export default Index;
