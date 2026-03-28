import React from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Pricing from "@/components/Pricing";
import Feedback from "@/components/Feedback";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <Hero onStart={() => navigate("/signup")} />
      <Features />
      <HowItWorks />
      <Pricing />
      <Feedback />
      <CTA />
      <Footer />
    </div>
  );
};

export default Index;
