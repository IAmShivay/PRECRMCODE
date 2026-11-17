
import React, { useEffect, useRef, useState } from 'react';

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  width?: "fit-content" | "100%";
  direction?: "left" | "right" | "none";
}

const Reveal: React.FC<RevealProps> = ({ 
  children, 
  delay = 0, 
  width = "100%",
  direction = "left" 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      {
        threshold: 0.05,
        rootMargin: '0px 0px 40px 0px',
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  // Determine horizontal offset based on direction
  const getHorizontalOffset = () => {
    if (direction === "none") return "0px";
    return direction === "left" ? "-20px" : "20px";
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        width,
        opacity: isVisible ? 1 : 0,
        // Combine vertical slide (30px) and horizontal drift (20px)
        transform: isVisible 
          ? 'translate(0, 0)' 
          : `translate(${getHorizontalOffset()}, 30px)`,
        // Using a long duration and custom cubic-bezier for that premium weightless feeling
        transition: `opacity 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}s, transform 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
};

export default Reveal;
