/** Широкий экран (как `lg:` в Tailwind) — раскладка «на компьютере». */
import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)";

export function useIsDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}
