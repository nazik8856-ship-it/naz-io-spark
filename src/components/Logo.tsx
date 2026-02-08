import { Link } from "react-router-dom";
import nazaiLogo from "@/assets/nazai-logo.png";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  linkTo?: string;
}

const Logo = ({ size = "md", linkTo }: LogoProps) => {
  const sizeClasses = {
    sm: {
      icon: "w-7 h-7",
      text: "text-lg",
    },
    md: {
      icon: "w-8 h-8",
      text: "text-xl",
    },
    lg: {
      icon: "w-10 h-10",
      text: "text-2xl",
    },
  };

  const classes = sizeClasses[size];

  const LogoContent = () => (
    <div className="flex items-center gap-2">
      {/* Logo Icon */}
      <img 
        src={nazaiLogo} 
        alt="NazAI Logo" 
        className={`${classes.icon} rounded-lg object-cover`}
      />
      {/* Logo Text - Satoshi font */}
      <span 
        className={`${classes.text} text-foreground`}
        style={{ 
          fontFamily: "'Satoshi', sans-serif",
          fontWeight: 700,
          letterSpacing: '-0.02em'
        }}
      >
        <span className="text-foreground">Naz</span>
        <span className="text-gradient">AI</span>
      </span>
    </div>
  );

  if (linkTo) {
    return (
      <Link to={linkTo} className="flex items-center gap-2 hover:opacity-90 transition-opacity">
        <LogoContent />
      </Link>
    );
  }

  return <LogoContent />;
};

export default Logo;
