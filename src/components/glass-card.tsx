import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
  hover?: boolean;
  gradient?: boolean;
  as?: "div" | "section" | "article";
}

export default function GlassCard({
  children,
  className,
  glow = false,
  hover = false,
  gradient = false,
  as: Tag = "div",
}: GlassCardProps) {
  return (
    <Tag
      className={cn(
        "rounded-2xl glass-strong p-6",
        "transition-all duration-300 ease-out",
        hover && "card-lift",
        glow && "glow-border",
        gradient && "gradient-border",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
