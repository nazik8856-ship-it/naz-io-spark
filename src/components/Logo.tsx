import { Link } from "react-router-dom";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  linkTo?: string;
}

const Logo = ({ size = "md", linkTo }: LogoProps) => {
  const sizeClasses = {
    sm: {
      icon: "w-7 h-7",
      text: "text-lg",
      letter: "text-sm",
    },
    md: {
      icon: "w-8 h-8",
      text: "text-xl",
      letter: "text-base",
    },
    lg: {
      icon: "w-10 h-10",
      text: "text-2xl",
      letter: "text-lg",
    },
  };

  const classes = sizeClasses[size];

  const LogoContent = () => (
    <div className="flex items-center gap-2">
      {/* Logo Icon */}
      <div className={`${classes.icon} rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center`}>
        <span className={`text-primary-foreground font-bold ${classes.letter}`}>N</span>
      </div>
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
