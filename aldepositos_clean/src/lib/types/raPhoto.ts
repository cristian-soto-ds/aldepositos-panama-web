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
