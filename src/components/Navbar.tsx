import { Button } from "@/components/ui/button";
import { Menu, X, LogOut } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "./Logo";
import { useAuth } from "@/hooks/useAuth";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  // RESTORED: Your navigation links
  const navLinks = [
    { name: "Features", href: "#features" },
    { name: "How it Works", href: "#how-it-works" },
    { name: "Feedback", href: "#feedback" },
    { name: "Pricing", href: "#pricing" },
  ];

  return (
    <nav className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Logo />

        {/* RESTORED: Desktop Navigation Links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a key={link.name} href={link.href} className="text-sm text-zinc-400 hover:text-white transition-colors">
              {link.name}
            </a>
          ))}
        </div>

        {/* Desktop Auth Buttons */}
        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <>
              <Button asChild variant="ghost" className="text-zinc-400 hover:text-white">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-zinc-400 hover:text-red-500">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" asChild className="text-white hover:text-neon-green">
                <Link to="/login">Sign In</Link>
              </Button>
              <Button asChild className="bg-neon-green text-black hover:bg-white font-bold">
                <Link to="/signup">Get Started</Link>
              </Button>
            </>
          )}
        </div>

        {/* RESTORED: Mobile Menu Button */}
        <button className="md:hidden text-white" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* RESTORED: Mobile Menu Content */}
      {isOpen && (
        <div className="md:hidden bg-black border-b border-white/10 p-4 space-y-4 flex flex-col">
          {navLinks.map((link) => (
            <a
              key={link.name}
              href={link.href}
              className="text-zinc-400 hover:text-white"
              onClick={() => setIsOpen(false)}
            >
              {link.name}
            </a>
          ))}
          <hr className="border-white/10" />
          {user ? (
            <Link to="/dashboard" className="text-neon-green font-bold" onClick={() => setIsOpen(false)}>
              Dashboard
            </Link>
          ) : (
            <Link to="/signup" className="text-white font-bold" onClick={() => setIsOpen(false)}>
              Get Started
            </Link>
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
