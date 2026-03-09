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
                {/* 7 extremely wide, soft, overlapping sakura petals */}
                
                {/* Petal 1 - top */}
                <path
                  d="M20 20 C10 16, 6 8, 10 2 C12 -1, 16 -2, 18 1 C19 -1, 19.8 -1.5, 20 1 C20.2 -1.5, 21 -1, 22 1 C24 -2, 28 -1, 30 2 C34 8, 30 16, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-1"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />
                {/* Petal 2 - upper-right */}
                <path
                  d="M20 20 C24 10, 32 4, 38 4 C42 4, 43 8, 41 10 C44 9, 44 12, 41 14 C43 17, 41 21, 37 22 C30 24, 24 23, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-2"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />
                {/* Petal 3 - lower-right */}
                <path
                  d="M20 20 C27 24, 33 31, 32 38 C31 42, 27 43, 26 41 C28 44, 26 44, 25 41 C24 43, 20 42, 19 38 C17 31, 18 24, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-3"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />
                {/* Petal 4 - lower-left */}
                <path
                  d="M20 20 C13 24, 7 31, 8 38 C9 42, 13 43, 14 41 C12 44, 14 44, 15 41 C16 43, 20 42, 21 38 C23 31, 22 24, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-4"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />
                {/* Petal 5 - upper-left */}
                <path
                  d="M20 20 C16 10, 8 4, 2 4 C-2 4, -3 8, -1 10 C-4 9, -4 12, -1 14 C-3 17, -1 21, 3 22 C10 24, 16 23, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-5"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />
                {/* Petal 6 - extra bottom-left (between petal 4 and 5) */}
                <path
                  d="M20 20 C14 20, 4 24, 1 30 C-1 34, 1 38, 4 37 C1 39, 2 40, 5 38 C4 41, 8 40, 10 37 C14 31, 17 24, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-6"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />
                {/* Petal 7 - extra bottom-right (between petal 2 and 3) */}
                <path
                  d="M20 20 C26 20, 36 24, 39 30 C41 34, 39 38, 36 37 C39 39, 38 40, 35 38 C36 41, 32 40, 30 37 C26 31, 23 24, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-7"
                  style={{ strokeDasharray: 100, strokeDashoffset: 100 }}
                />

                {/* Center pistil circle */}
                <circle cx="20" cy="20" r="3.5" stroke="currentColor" strokeWidth="0.7" fill="none"
                  className="blossom-draw-center blossom-center"
                  style={{ strokeDasharray: 22, strokeDashoffset: 22 }}
                />

                {/* Delicate stamens */}
                <line x1="20" y1="16.5" x2="20" y2="13" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <line x1="23" y1="17.5" x2="26" y2="15.5" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="23.5" y1="20" x2="27" y2="20" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <line x1="23" y1="22.5" x2="26" y2="24.5" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <line x1="20" y1="23.5" x2="20" y2="27" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <line x1="17" y1="22.5" x2="14" y2="24.5" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <line x1="16.5" y1="20" x2="13" y2="20" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <line x1="17" y1="17.5" x2="14" y2="15.5" stroke="currentColor" strokeWidth="0.45" strokeLinecap="round" className="blossom-stamen blossom-stamen-2" opacity="0" />
                {/* Pollen dots */}
                <circle cx="20" cy="12.5" r="0.6" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="26.5" cy="15" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="27.5" cy="20" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <circle cx="26.5" cy="25" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="20" cy="27.5" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
                <circle cx="13.5" cy="25" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-3" opacity="0" />
                <circle cx="12.5" cy="20" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-1" opacity="0" />
                <circle cx="13.5" cy="15" r="0.5" fill="currentColor" className="blossom-stamen blossom-stamen-2" opacity="0" />
              </g>

              {/* Falling sakura petals */}
              <path d="M12 32 C11 34, 10 37, 11 38 C10.5 37, 12 35, 12 32 Z" stroke="currentColor" strokeWidth="0.5" fill="none" className="falling-petal falling-petal-1" opacity="0" />
              <path d="M26 33 C27 35, 27 38, 26 39 C27 38, 25 36, 26 33 Z" stroke="currentColor" strokeWidth="0.5" fill="none" className="falling-petal falling-petal-2" opacity="0" />
              <path d="M19 34 C18 36, 18 39, 19 40 C18.5 39, 19.5 37, 19 34 Z" stroke="currentColor" strokeWidth="0.5" fill="none" className="falling-petal falling-petal-3" opacity="0" />
              <path d="M8 35 C7 37, 7.5 39, 8.5 39 C7.5 39, 8.5 37, 8 35 Z" stroke="currentColor" strokeWidth="0.4" fill="none" className="falling-petal falling-petal-4" opacity="0" />
              <path d="M30 36 C31 38, 30 40, 29 40 C30 39, 29 38, 30 36 Z" stroke="currentColor" strokeWidth="0.4" fill="none" className="falling-petal falling-petal-5" opacity="0" />
              <path d="M15 36 C14 38, 14.5 40, 15.5 40 C14.5 40, 15.5 38, 15 36 Z" stroke="currentColor" strokeWidth="0.4" fill="none" className="falling-petal falling-petal-6" opacity="0" />
              <path d="M23 35 C24 37, 23.5 39, 22.5 39 C23.5 39, 22.5 37, 23 35 Z" stroke="currentColor" strokeWidth="0.4" fill="none" className="falling-petal falling-petal-7" opacity="0" />
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
