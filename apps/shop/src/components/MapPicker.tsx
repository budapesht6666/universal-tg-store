/**
 * Точка доставки: пин по центру карты, карту двигают под ним (как в Grab и Яндекс Go).
 * Точка считается поставленной, когда покупатель подвинул карту, нажал «Я сейчас здесь»
 * или вставил ссылку. Сдвиг меньше MIN_SHIFT_PX — дрожание пальца или мыши при касании,
 * точкой не считается. Масштаб, на котором поставили пин, запоминаем: мелкий — точка примерная.
 *
 * Карта — MapLibre + OpenFreeMap (векторные плитки OpenStreetMap, без ключа и лимитов).
 * tile.openstreetmap.org из Вьетнама открывается не всегда, CARTO требует ключ.
 * Библиотека грузится только здесь, чтобы меню открывалось быстро.
 * С зоной доставки на карте пунктиром — границы её кругов.
 */
import type { DeliveryCircle } from "@store/schema";
import { Move } from "lucide-react";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { DraftLocation } from "../lib/cart.ts";
import { isCoarse } from "../lib/location.ts";
import { canLocate } from "../lib/telegram.ts";

/** Где открыть карту, пока точки нет. Для другого города — поменять здесь. */
export const DEFAULT_CENTER = { lat: 15.8801, lng: 108.338 };
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_ZOOM = 13;
const PIN_ZOOM = 17;
/** Масштаб превью на экране проверки: виден квартал и ближайшие улицы. */
const PREVIEW_ZOOM = 16;
/** Сдвиг карты меньше этого — дрожание при касании, а не выбор точки. */
const MIN_SHIFT_PX = 10;

type Props = {
  value: DraftLocation | null;
  onChange: (location: DraftLocation) => void;
  /** Круги зоны доставки; пусто — зона выключена. */
  zone?: DeliveryCircle[];
};

type GeoData = Parameters<GeoJSONSource["setData"]>[0];

/** Круг на карте (погрешность GPS, круг зоны) — многоугольник из 64 точек. */
function circleCoords(lat: number, lng: number, meters: number): [number, number][] {
  const coords: [number, number][] = [];
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return coords;
}

function circle(lat: number, lng: number, meters: number): GeoData {
  const coords = circleCoords(lat, lng, meters);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

function zoneData(circles: DeliveryCircle[]): GeoData {
  return {
    type: "FeatureCollection",
    features: circles.map((c) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: circleCoords(c.lat, c.lng, c.radiusKm * 1000),
      },
    })),
  };
}

const EMPTY: GeoData = { type: "FeatureCollection", features: [] };

type MapOptions = ConstructorParameters<typeof import("maplibre-gl").Map>[0];

/** Грузит MapLibre (только на экранах с картой, чтобы меню открывалось быстро) и создаёт карту. */
async function createMap(options: MapOptions): Promise<MlMap> {
  const [{ Map: MapClass, setWorkerUrl }, worker] = await Promise.all([
    import("maplibre-gl"),
    // Vite 8: воркер MapLibre подключается отдельным файлом (документация MapLibre v6).
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  setWorkerUrl(worker.default);
  return new MapClass(options);
}

/** Слои поверх плиток: граница зоны доставки и круг погрешности GPS. */
function addOverlays(m: MlMap) {
  m.addSource("zone", { type: "geojson", data: EMPTY });
  m.addLayer({
    id: "zone-line",
    type: "line",
    source: "zone",
    paint: { "line-color": "#b5482a", "line-width": 2.5, "line-dasharray": [3, 2] },
  });
  m.addSource("accuracy", { type: "geojson", data: EMPTY });
  m.addLayer({
    id: "accuracy-fill",
    type: "fill",
    source: "accuracy",
    paint: { "fill-color": "#b5482a", "fill-opacity": 0.1 },
  });
  m.addLayer({
    id: "accuracy-line",
    type: "line",
    source: "accuracy",
    paint: { "line-color": "#b5482a", "line-width": 1.5, "line-opacity": 0.5 },
  });
}

/** Пин по центру карты: остриё — ровно в центре. */
function CenterPin() {
  return (
    <svg
      width="34"
      height="44"
      viewBox="0 0 24 32"
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full drop-shadow"
    >
      <path d="M12 31s10-11.2 10-19A10 10 0 0 0 2 12c0 7.8 10 19 10 19Z" fill="var(--accent)" />
      <circle cx="12" cy="12" r="4" fill="#fff" />
    </svg>
  );
}

export function MapPicker({ value, onChange, zone = [] }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const initial = useRef(value);
  /** Точка, которую карта уже показывает (поставили пальцем или перенесли), — второй раз не двигаем. */
  const applied = useRef<string | null>(value ? locationKey(value) : null);

  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    (async () => {
      try {
        if (cancelled || !box.current) return;
        const start = initial.current ?? DEFAULT_CENTER;
        const instance = await createMap({
          container: box.current,
          style: MAP_STYLE,
          center: [start.lng, start.lat],
          zoom: initial.current ? (initial.current.zoom ?? PIN_ZOOM) : DEFAULT_ZOOM,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
        });
        if (cancelled) {
          instance.remove();
          return;
        }
        m = instance;
        instance.touchZoomRotate.disableRotation();
        // Где карта стояла до движения. movestart приходит, когда карта уже сдвинулась,
        // поэтому сравниваем с положением после прошлого moveend.
        let rest = instance.getCenter();
        let userMoving = false;
        instance.on("movestart", (e) => {
          if (e.originalEvent) userMoving = true;
        });
        instance.on("moveend", () => {
          const from = rest;
          const c = instance.getCenter();
          rest = c;
          if (!userMoving) return;
          userMoving = false;
          const zoom = Math.round(instance.getZoom() * 10) / 10;
          const a = instance.project(from);
          const b = instance.project(c);
          if (Math.hypot(a.x - b.x, a.y - b.y) < MIN_SHIFT_PX) {
            // Дрожание при касании — не точка. Пин поставлен грубо, а карту приблизили и он
            // остался на месте — покупатель увидел его крупнее, точка больше не примерная.
            const current = valueRef.current;
            if (current?.source === "pin" && current.zoom !== undefined && zoom > current.zoom) {
              onChangeRef.current({ ...current, zoom });
            }
            return;
          }
          (instance.getSource("accuracy") as GeoJSONSource | undefined)?.setData(EMPTY);
          const next: DraftLocation = { lat: round(c.lat), lng: round(c.lng), source: "pin", zoom };
          applied.current = locationKey(next);
          onChangeRef.current(next);
        });
        instance.on("load", () => {
          addOverlays(instance);
          setReady(true);
        });
        map.current = instance;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      m?.remove();
      map.current = null;
    };
  }, []);

  // Границы зоны доставки.
  const zoneKey = JSON.stringify(zone);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource("zone") as GeoJSONSource | undefined)?.setData(zoneData(JSON.parse(zoneKey)));
  }, [zoneKey, ready]);

  // Точка пришла снаружи (GPS, ссылка, прошлый заказ) — переносим карту и рисуем круг погрешности.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !value) return;
    const key = locationKey(value);
    if (applied.current === key) return;
    applied.current = key;
    const zoom = value.zoom ?? (value.accuracy && value.accuracy > 150 ? 15 : PIN_ZOOM);
    m.easeTo({ center: [value.lng, value.lat], zoom, duration: 600 });
    (m.getSource("accuracy") as GeoJSONSource | undefined)?.setData(
      value.accuracy ? circle(value.lat, value.lng, value.accuracy) : EMPTY,
    );
  }, [value, ready]);

  return (
    <div className="relative h-[220px] overflow-hidden bg-muted">
      {/* Свой CSS MapLibre ставит контейнеру position: relative — позиционируем обёртку. */}
      <div className="absolute inset-0">
        <div ref={box} className="h-full w-full" />
      </div>
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-hint">
          {canLocate()
            ? "Карта не загрузилась. Нажмите «Я сейчас здесь» или вставьте ссылку из Google Maps."
            : "Карта не загрузилась. Вставьте ссылку из Google Maps."}
        </div>
      )}
      <CenterPin />
      <span className="pointer-events-none absolute top-2.5 left-2.5 flex h-7 items-center gap-1.5 rounded-full bg-white/95 px-2.5 text-xs font-semibold text-[#0b0b0c] shadow">
        <Move size={14} strokeWidth={2.2} />
        {value && isCoarse(value)
          ? "Приблизьте карту — так точнее"
          : "Двигайте карту — пин встанет точно"}
      </span>
    </div>
  );
}

/**
 * Карта на экране проверки заказа: только показывает точку, двигать её нельзя —
 * здесь смотрят, а правят на оформлении.
 */
export function MapPreview({
  value,
  zone = [],
}: {
  value: DraftLocation;
  zone?: DeliveryCircle[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const initial = useRef({ value, zone });

  useEffect(() => {
    let cancelled = false;
    let m: MlMap | null = null;
    (async () => {
      try {
        if (!box.current) return;
        const { value: v, zone: circles } = initial.current;
        const zoom =
          v.zoom !== undefined && isCoarse(v)
            ? v.zoom
            : v.accuracy && v.accuracy > 150
              ? 15
              : PREVIEW_ZOOM;
        const instance = await createMap({
          container: box.current,
          style: MAP_STYLE,
          center: [v.lng, v.lat],
          zoom,
          interactive: false,
          attributionControl: { compact: true },
        });
        if (cancelled) {
          instance.remove();
          return;
        }
        m = instance;
        instance.on("load", () => {
          addOverlays(instance);
          (instance.getSource("zone") as GeoJSONSource | undefined)?.setData(zoneData(circles));
          if (v.source === "gps" && v.accuracy) {
            (instance.getSource("accuracy") as GeoJSONSource | undefined)?.setData(
              circle(v.lat, v.lng, v.accuracy),
            );
          }
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      m?.remove();
    };
  }, []);

  return (
    <div className="relative h-[176px] overflow-hidden bg-muted">
      <div className="absolute inset-0">
        <div ref={box} className="h-full w-full" />
      </div>
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-hint">
          Карта не загрузилась. Точка — {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </div>
      )}
      <CenterPin />
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const locationKey = (l: DraftLocation) => `${l.lat},${l.lng},${l.accuracy ?? ""}`;
