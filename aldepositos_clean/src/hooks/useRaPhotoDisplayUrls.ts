"use client";

import { useEffect, useState } from "react";
import type { RaPhoto } from "@/lib/types/raPhoto";
import {
  createRaPhotoObjectUrl,
  displayUrlForRaPhoto,
} from "@/lib/raPhotoStorage";

/**
 * Resuelve URLs de fotos vía Storage autenticado (blob:) para que se vean
 * aunque el bucket no sea público o la URL guardada esté obsoleta.
 */
export function useRaPhotoDisplayUrls(photos: RaPhoto[], taskId?: string) {
  const [urlsById, setUrlsById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const blobUrls: string[] = [];

    const run = async () => {
      if (photos.length === 0) {
        setUrlsById({});
        return;
      }
      setLoading(true);
      const next: Record<string, string> = {};
      for (const photo of photos) {
        if (cancelled) return;
        try {
          const url = await createRaPhotoObjectUrl(photo, taskId);
          if (url.startsWith("blob:")) blobUrls.push(url);
          next[photo.id] = url;
        } catch {
          next[photo.id] = displayUrlForRaPhoto(photo, taskId);
        }
      }
      if (!cancelled) {
        setUrlsById(next);
        setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
      for (const u of blobUrls) URL.revokeObjectURL(u);
    };
  }, [photos, taskId]);

  const srcFor = (photo: RaPhoto) =>
    urlsById[photo.id] || displayUrlForRaPhoto(photo, taskId);

  return { srcFor, loading };
}
