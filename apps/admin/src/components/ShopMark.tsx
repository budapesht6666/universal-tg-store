/** Знак магазина: загруженный логотип или первая буква названия на акцентном фоне. */
export function ShopMark({
  name,
  logo,
  size = 32,
}: {
  name: string;
  logo?: { url: string } | undefined;
  size?: number;
}) {
  if (logo) {
    return (
      <img
        src={logo.url}
        alt=""
        width={size}
        height={size}
        className="flex-none rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex flex-none items-center justify-center rounded-lg bg-accent font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
