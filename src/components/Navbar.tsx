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
              className="w-7 h-7 overflow-visible"
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Cherry blossom flower - spins then collapses */}
              <g className="blossom-container">
                {/* Petal 1 - top */}
                <path
                  d="M20 8 Q17 12 20 16 Q23 12 20 8 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="blossom-draw blossom-petal blossom-petal-1"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
                />
                {/* Petal 2 - top-right */}
                <path
                  d="M27 12 Q23 12 21 16 Q25 15 27 12 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="blossom-draw blossom-petal blossom-petal-2"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
                />
                {/* Petal 3 - bottom-right */}
                <path
                  d="M26 23 Q24 19 20 18 Q22 22 26 23 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="blossom-draw blossom-petal blossom-petal-3"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
                />
                {/* Petal 4 - bottom-left */}
                <path
                  d="M14 23 Q16 19 20 18 Q18 22 14 23 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="blossom-draw blossom-petal blossom-petal-4"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
                />
                {/* Petal 5 - top-left */}
                <path
                  d="M13 12 Q17 12 19 16 Q15 15 13 12 Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  className="blossom-draw blossom-petal blossom-petal-5"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40 }}
                />
                {/* Center stamen */}
                <circle
                  cx="20"
                  cy="16"
                  r="2"
                  stroke="currentColor"
                  strokeWidth="1"
                  fill="none"
                  className="blossom-draw-center blossom-center"
                  style={{ strokeDasharray: 14, strokeDashoffset: 14 }}
                />
                {/* Stamen dots */}
                <circle cx="20" cy="14" r="0.6" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="21.5" cy="15.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="18.5" cy="15.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
              </g>
              {/* Falling petals (appear during collapse) */}
              <path d="M16 26 Q15 28 16 30" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" fill="none" className="falling-petal falling-petal-1" opacity="0" />
              <path d="M22 27 Q23 29 22 31" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" fill="none" className="falling-petal falling-petal-2" opacity="0" />
              <path d="M19 28 Q18 31 19 33" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" fill="none" className="falling-petal falling-petal-3" opacity="0" />
              <circle cx="14" cy="32" r="0.5" fill="currentColor" className="falling-petal falling-petal-4" opacity="0" />
              <circle cx="24" cy="33" r="0.4" fill="currentColor" className="falling-petal falling-petal-5" opacity="0" />
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
