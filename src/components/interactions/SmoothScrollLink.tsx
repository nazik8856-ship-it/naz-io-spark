import React from "react";

interface Props extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Vertical offset to account for sticky headers */
  offset?: number;
}

/**
 * Anchor that smoothly scrolls to in-page targets (#id), respecting a sticky-header offset.
 * Falls back to default navigation for external links.
 */
const SmoothScrollLink: React.FC<Props> = ({ href, offset = 72, onClick, children, ...rest }) => {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (href.startsWith("#")) {
      const id = href.slice(1);
      const target = id ? document.getElementById(id) : document.scrollingElement;
      if (target) {
        e.preventDefault();
        const top = id
          ? (target as HTMLElement).getBoundingClientRect().top + window.scrollY - offset
          : 0;
        window.scrollTo({ top, behavior: "smooth" });
        history.replaceState(null, "", href);
      }
    }
    onClick?.(e);
  };

  return (
    <a href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
};

export default SmoothScrollLink;
