import { useEffect, useRef, useState } from "react";

type SplashScreenProps = {
  onComplete: () => void;
};

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const [visible, setVisible] = useState(true);
  const logoUrl = new URL("../../../../assets/ambient-eclipse.svg", import.meta.url).href;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onCompleteRef.current(), 600);
    }, 1400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex-1 flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <div className="flex items-center justify-center gap-[clamp(0.5rem,1vw,1rem)]">
        <img
          src={logoUrl}
          alt="Ambient logo"
          className="h-[clamp(4rem,12vw,8rem)] w-auto"
          draggable={false}
        />
        <h1 className="font-serif text-[clamp(4rem,12vw,8rem)] font-normal text-[#e8e4dc] leading-[0.9] tracking-[-0.02em]">
          Ambient
        </h1>
      </div>
    </div>
  );
}
