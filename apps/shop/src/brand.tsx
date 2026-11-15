/**
 * Знак бренда для обложки меню, заглушек блюд без фото и подписи внизу меню.
 * В шаблоне меняется здесь (и цвета/узоры — блок «Бренд» в `index.css`).
 */
import type { CSSProperties } from "react";

export function BrandMark({
  tone = "color",
  className,
  style,
}: {
  /** color — кирпичный знак; light — светлый корпус для тёмного фона (обложка). */
  tone?: "color" | "light";
  className?: string;
  style?: CSSProperties;
}) {
  const body = tone === "light" ? "#FBF4EC" : "#B5482A";
  const mouth = tone === "light" ? "#B5482A" : "#FFFFFF";
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className} style={style}>
      <rect x="38" y="6" width="9" height="16" rx="2" fill={body} />
      <rect x="10" y="18" width="44" height="38" rx="7" fill={body} />
      <path d="M21 50V40a11 11 0 0 1 22 0v10z" fill={mouth} />
      <path
        d="M32 48c-3.6 0-6-2.5-6-5.6 0-3.6 3.4-5.4 3.6-9.4 2.9 1.8 8.4 5.6 8.4 9.6 0 3-2.4 5.4-6 5.4z"
        fill="#F2A541"
      />
    </svg>
  );
}
