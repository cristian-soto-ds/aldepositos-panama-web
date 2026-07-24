export type RaPhotoCategory =
  | "general"
  | "bulto"
  | "etiqueta"
  | "daño"
  | "pallet";

export type RaPhoto = {
  id: string;
  url: string;
  storagePath: string;
  caption?: string;
  category?: RaPhotoCategory;
  takenAt: string;
  takenByEmail?: string;
  takenByName?: string;
};

export type RaPhotoRecord = {
  photos: RaPhoto[];
  lastUpdatedAt?: string;
  /** RA marcado en cola para registro fotográfico (aunque aún no tenga fotos). */
  requested?: boolean;
  /** Último inventariador que capturó/subió una foto en este RA. */
  lastTakenBy?: {
    email: string;
    displayName?: string;
    at: string;
  };
};

export const RA_PHOTO_CATEGORY_LABELS: Record<RaPhotoCategory, string> = {
  general: "General",
  bulto: "Bulto",
  etiqueta: "Etiqueta",
  daño: "Daño",
  pallet: "Pallet",
};

export const RA_PHOTO_CATEGORIES: RaPhotoCategory[] = [
  "general",
  "bulto",
  "etiqueta",
  "daño",
  "pallet",
];
