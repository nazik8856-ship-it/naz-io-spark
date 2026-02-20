import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "./Logo";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const navLinks = [
    { name: "Features", href: "#features" },
    { name: "How it Works", href: "#how-it-works" },
    
    { name: "Feedback", href: "#feedback" },
    { name: "Pricing", href: "#pricing" },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 glass transition-all duration-700 ease-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'}`}>
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <Logo linkTo="/" />
            <svg
              className="w-6 h-6 overflow-visible"
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Left half of coconut */}
              <g className="coconut-top-half">
                <path
                  d="M6 18 Q6 10 16 10 Q26 10 26 18 Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="coconut-draw"
                  style={{ strokeDasharray: 60, strokeDashoffset: 60 }}
                />
              </g>
              {/* Right half of coconut */}
              <g className="coconut-bottom-half">
                <path
                  d="M6 18 Q6 27 16 28 Q26 27 26 18 Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="coconut-draw"
                  style={{ strokeDasharray: 60, strokeDashoffset: 60 }}
                />
              </g>
              {/* Shell texture */}
              <path
                d="M9 17 Q12 14 16 16 Q20 18 23 15"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                fill="none"
                opacity="0.4"
                className="coconut-draw-delayed coconut-texture"
              />
              {/* Stem */}
              <path
                d="M14 10 Q16 7 18 10"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                fill="none"
                className="coconut-draw-delayed2 coconut-stem"
              />
              {/* Leaf */}
              <path
                d="M16 7 Q20 3 22 6"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
                fill="none"
                className="coconut-draw-delayed2 coconut-stem"
              />
              {/* Water drops */}
              <line x1="14" y1="28" x2="13" y2="34" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="coconut-water-1" opacity="0" />
              <line x1="16" y1="28" x2="16" y2="36" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="coconut-water-2" opacity="0" />
              <line x1="18" y1="28" x2="19" y2="34" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" className="coconut-water-3" opacity="0" />
              {/* Splash drops */}
              <circle cx="12" cy="35" r="0.8" fill="currentColor" className="coconut-splash-1" opacity="0" />
              <circle cx="16" cy="37" r="0.6" fill="currentColor" className="coconut-splash-2" opacity="0" />
              <circle cx="20" cy="35" r="0.7" fill="currentColor" className="coconut-splash-3" opacity="0" />
            </svg>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                {link.name}
              </a>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Log in</Link>
            </Button>
            <Button variant="default" size="sm" asChild>
              <Link to="/signup">Get Started</Link>
            </Button>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-foreground"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isOpen && (
          <div className="md:hidden pt-4 pb-2">
            <div className="flex flex-col gap-4">
              {navLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground transition-colors duration-200 py-2"
                  onClick={() => setIsOpen(false)}
                >
                  {link.name}
                </a>
              ))}
              <div className="flex flex-col gap-2 pt-4 border-t border-border">
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/login" onClick={() => setIsOpen(false)}>Log in</Link>
                </Button>
                <Button variant="default" size="sm" asChild>
                  <Link to="/signup" onClick={() => setIsOpen(false)}>Get Started</Link>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
