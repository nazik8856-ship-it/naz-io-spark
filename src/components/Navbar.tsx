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
              <g className="blossom-container">
                {/* 5 round sakura petals with notched tips, arranged around center */}
                {/* Petal 1 - top */}
                <path
                  d="M20 6 C17 8, 16 12, 18.5 15 C19 14.5, 21 14.5, 21.5 15 C24 12, 23 8, 20 6 Z"
                  stroke="currentColor" strokeWidth="1.1" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-1"
                  style={{ strokeDasharray: 45, strokeDashoffset: 45 }}
                />
                {/* Petal 2 - top-right */}
                <path
                  d="M28 11 C25 10, 22 11, 21.5 14 C22 14, 22.5 15.5, 22 16 C24 17, 28 15, 28 11 Z"
                  stroke="currentColor" strokeWidth="1.1" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-2"
                  style={{ strokeDasharray: 45, strokeDashoffset: 45 }}
                />
                {/* Petal 3 - bottom-right */}
                <path
                  d="M27 22 C25 19, 23 18, 21 18 C21.5 19, 21 20.5, 20.5 21 C22 23, 25 24, 27 22 Z"
                  stroke="currentColor" strokeWidth="1.1" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-3"
                  style={{ strokeDasharray: 45, strokeDashoffset: 45 }}
                />
                {/* Petal 4 - bottom-left */}
                <path
                  d="M13 22 C15 24, 18 23, 19.5 21 C19 20.5, 18.5 19, 19 18 C17 18, 15 19, 13 22 Z"
                  stroke="currentColor" strokeWidth="1.1" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-4"
                  style={{ strokeDasharray: 45, strokeDashoffset: 45 }}
                />
                {/* Petal 5 - top-left */}
                <path
                  d="M12 11 C12 15, 16 17, 18 16 C17.5 15.5, 18 14, 18.5 14 C18 11, 15 10, 12 11 Z"
                  stroke="currentColor" strokeWidth="1.1" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-5"
                  style={{ strokeDasharray: 45, strokeDashoffset: 45 }}
                />
                {/* Center circle */}
                <circle cx="20" cy="16.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none"
                  className="blossom-draw-center blossom-center"
                  style={{ strokeDasharray: 16, strokeDashoffset: 16 }}
                />
                {/* Stamen lines radiating from center */}
                <line x1="20" y1="14" x2="20" y2="12.5" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <line x1="22" y1="15" x2="23.5" y2="14" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="22" y1="18" x2="23.2" y2="19.2" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <line x1="18" y1="18" x2="16.8" y2="19.2" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="18" y1="15" x2="16.5" y2="14" stroke="currentColor" strokeWidth="0.7" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                {/* Stamen tip dots */}
                <circle cx="20" cy="12" r="0.6" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="24" cy="13.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="23.5" cy="19.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <circle cx="16.5" cy="19.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="16" cy="13.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
              </g>
              {/* Falling petal fragments after collapse */}
              <path d="M15 28 C14 29, 13.5 31, 14.5 32" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" fill="none" className="falling-petal falling-petal-1" opacity="0" />
              <path d="M23 29 C24 30, 24.5 32, 23.5 33" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" fill="none" className="falling-petal falling-petal-2" opacity="0" />
              <path d="M19 30 C18.5 32, 19.5 34, 19 35" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" fill="none" className="falling-petal falling-petal-3" opacity="0" />
              <circle cx="12" cy="34" r="0.5" fill="currentColor" className="falling-petal falling-petal-4" opacity="0" />
              <circle cx="26" cy="35" r="0.4" fill="currentColor" className="falling-petal falling-petal-5" opacity="0" />
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
