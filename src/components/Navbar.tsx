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
                  d="M20 20 C8 15, 2 6, 8 -2 C11 -5, 15 -4, 17 0 C18 -3, 19.5 -3, 20 0 C20.5 -3, 22 -3, 23 0 C25 -4, 29 -5, 32 -2 C38 6, 32 15, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-1"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
                />
                {/* Petal 2 - upper-right */}
                <path
                  d="M20 20 C25 8, 34 0, 42 -1 C46 -1, 47 4, 44 7 C48 5, 48 10, 44 13 C47 17, 44 22, 39 24 C30 26, 24 24, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-2"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
                />
                {/* Petal 3 - lower-right */}
                <path
                  d="M20 20 C28 25, 36 34, 34 42 C33 46, 28 47, 27 44 C29 48, 27 48, 26 44 C24 47, 20 46, 18 42 C15 34, 17 25, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-3"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
                />
                {/* Petal 4 - lower-left */}
                <path
                  d="M20 20 C12 25, 4 34, 6 42 C7 46, 12 47, 13 44 C11 48, 13 48, 14 44 C16 47, 20 46, 22 42 C25 34, 23 25, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-4"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
                />
                {/* Petal 5 - upper-left */}
                <path
                  d="M20 20 C15 8, 6 0, -2 -1 C-6 -1, -7 4, -4 7 C-8 5, -8 10, -4 13 C-7 17, -4 22, 1 24 C10 26, 16 24, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-5"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
                />
                {/* Petal 6 - middle-left */}
                <path
                  d="M20 20 C10 17, 0 16, -4 20 C-7 23, -6 28, -3 27 C-7 29, -6 31, -3 29 C-5 33, -2 34, 1 31 C6 27, 14 23, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-6"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
                />
                {/* Petal 7 - middle-right */}
                <path
                  d="M20 20 C30 17, 40 16, 44 20 C47 23, 46 28, 43 27 C47 29, 46 31, 43 29 C45 33, 42 34, 39 31 C34 27, 26 23, 20 20 Z"
                  stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" fill="none"
                  className="blossom-draw blossom-petal blossom-petal-7"
                  style={{ strokeDasharray: 120, strokeDashoffset: 120 }}
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
