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
              className="w-8 h-8 overflow-visible"
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g className="blossom-container">
                {/* Sakura - extremely wide, round, overlapping petals with tiny notch at tip */}
                
                {/* Petal 1 - top: wide oval bulging outward */}
                <path
                  d="M20 20 C12 18, 8 12, 10 6 C11 3, 14 2, 16 3 C18 1, 19.5 1, 19.8 3.5 C20.2 3.5, 20.5 1, 22 1 C24 2, 29 3, 30 6 C32 12, 28 18, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-1"
                  style={{ strokeDasharray: 90, strokeDashoffset: 90 }}
                />
                {/* Petal 2 - right: wide oval */}
                <path
                  d="M20 20 C22 12, 28 7, 34 6 C37 5.5, 39 8, 38 10 C40 8.5, 40 11, 38 13 C39 16, 37 19, 34 20 C28 22, 22 22, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-2"
                  style={{ strokeDasharray: 90, strokeDashoffset: 90 }}
                />
                {/* Petal 3 - bottom-right */}
                <path
                  d="M20 20 C26 23, 30 29, 29 35 C28.5 38, 26 39, 24.5 37.5 C26 40, 24 40, 23 37.5 C21 39, 18 37, 18 34 C17 28, 18 23, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-3"
                  style={{ strokeDasharray: 90, strokeDashoffset: 90 }}
                />
                {/* Petal 4 - bottom-left */}
                <path
                  d="M20 20 C14 23, 10 29, 11 35 C11.5 38, 14 39, 15.5 37.5 C14 40, 16 40, 17 37.5 C19 39, 22 37, 22 34 C23 28, 22 23, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-4"
                  style={{ strokeDasharray: 90, strokeDashoffset: 90 }}
                />
                {/* Petal 5 - left: wide oval */}
                <path
                  d="M20 20 C18 12, 12 7, 6 6 C3 5.5, 1 8, 2 10 C0 8.5, 0 11, 2 13 C1 16, 3 19, 6 20 C12 22, 18 22, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.7" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-5"
                  style={{ strokeDasharray: 90, strokeDashoffset: 90 }}
                />

                {/* Center pistil circle */}
                <circle cx="20" cy="20" r="3" stroke="currentColor" strokeWidth="0.8" fill="none"
                  className="blossom-draw-center blossom-center"
                  style={{ strokeDasharray: 19, strokeDashoffset: 19 }}
                />

                {/* Delicate stamens radiating outward */}
                <line x1="20" y1="17" x2="20" y2="14.5" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <line x1="22.8" y1="18.5" x2="24.8" y2="17" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="22" y1="21.5" x2="23.5" y2="23.5" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <line x1="18" y1="21.5" x2="16.5" y2="23.5" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="17.2" y1="18.5" x2="15.2" y2="17" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                {/* Extra stamens for fullness */}
                <line x1="21.5" y1="17.5" x2="22.5" y2="15.5" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <line x1="18.5" y1="17.5" x2="17.5" y2="15.5" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="23" y1="20" x2="25" y2="20" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <line x1="17" y1="20" x2="15" y2="20" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />

                {/* Stamen tip dots (pollen) */}
                <circle cx="20" cy="14" r="0.6" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="25.2" cy="16.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="24" cy="24" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <circle cx="16" cy="24" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="14.8" cy="16.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <circle cx="22.8" cy="15" r="0.45" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="17.2" cy="15" r="0.45" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="25.5" cy="20" r="0.45" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <circle cx="14.5" cy="20" r="0.45" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
              </g>

              {/* Falling sakura petals after collapse - small curved petal shapes */}
              <path d="M14 30 C13 31, 12.5 33, 13.5 34 C13 33, 14.5 32, 14 30 Z" stroke="currentColor" strokeWidth="0.6" fill="none" className="falling-petal falling-petal-1" opacity="0" />
              <path d="M24 31 C25 32, 25.5 34, 24.5 35 C25 34, 23.5 33, 24 31 Z" stroke="currentColor" strokeWidth="0.6" fill="none" className="falling-petal falling-petal-2" opacity="0" />
              <path d="M19 32 C18 33.5, 18 35.5, 19 36 C18.5 35, 19.5 34, 19 32 Z" stroke="currentColor" strokeWidth="0.6" fill="none" className="falling-petal falling-petal-3" opacity="0" />
              <path d="M10 33 C9.5 34, 10 35.5, 11 35 C10 35, 10.5 34, 10 33 Z" stroke="currentColor" strokeWidth="0.5" fill="none" className="falling-petal falling-petal-4" opacity="0" />
              <path d="M28 34 C28.5 35, 28 36.5, 27 36 C28 36, 27.5 35, 28 34 Z" stroke="currentColor" strokeWidth="0.5" fill="none" className="falling-petal falling-petal-5" opacity="0" />
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
