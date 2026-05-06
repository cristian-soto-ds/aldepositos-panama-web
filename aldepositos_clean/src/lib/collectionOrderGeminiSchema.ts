import { Type } from "@google/genai";

/** Salida JSON forzada del modelo: texto + líneas para la tabla de recolección */
export const collectionGeminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        "Español, breve y operativo (3–8 frases o viñetas): archivo o texto reconocido, nº líneas, conversiones docenas/dz→piezas si hubo, dudas mínimas; tono profesional de piso logístico.",
    },
    lines: {
      type: Type.ARRAY,
      description:
        "Filas extraídas del documento o del mensaje. Una fila por referencia/código de pieza. Cadenas vacías si no aplica.",
      items: {
        type: Type.OBJECT,
        properties: {
          referencia: { type: Type.STRING },
          descripcion: {
            type: Type.STRING,
            description:
              "Nombre del artículo SIN medidas ni dimensiones en texto (no '10X10X10CM'). SIN género (no dama/caballero); el género va en campo genero. Ej: ESFERA, JIRAFA DECOR, PANTALON JEANS.",
          },
          bultos: { type: Type.STRING },
          unidadesPorBulto: {
            type: Type.STRING,
            description:
              "Piezas por UN bulto/caja. Convierte docenas/dz/pares a piezas. Si el total de línea no divide en entero entre bultos (ej. 140 piezas y 3 bultos), déjalo vacío y usa unidadesTotales.",
          },
          unidadesTotales: {
            type: Type.STRING,
            description:
              "Total piezas de la línea (entero). Si la factura dice cantidad como N (M) = N docenas + M piezas (ej. 11 (8) → 140), pon 140 aquí. Docenas sueltas: 10 dz → 120. La app reparte total÷bultos con decimales si hace falta.",
          },
          pesoUnaPiezaKg: {
            type: Type.STRING,
            description:
              "Peso en kg de una sola pieza cuando el documento lo permita derivar (peso por bulto ÷ piezas por bulto). El CSV Magaya usa columna PESO = pesoPorBulto (mismo que «Peso por Piezas» al descargar CSV); rellena pesoPorBulto en coherencia con el documento.",
          },
          pesoPorBulto: {
            type: Type.STRING,
            description:
              "Peso en kg que la app usa igual que la columna «Peso por Piezas» al descargar CSV y como columna PESO en CSV Magaya: es el peso por bulto (no el total de la línea entera salvo que el documento lo defina así). Si el doc da solo peso por pieza × unidades por bulto, calcula el producto aquí.",
          },
          pesoTotalKg: {
            type: Type.STRING,
            description:
              "Peso total de la línea en kg si aplica. Si solo hay peso por pieza y cantidades, puedes calcular o dejar vacío.",
          },
          l: {
            type: Type.STRING,
            description: "Largo en cm (medidas solo aquí, no en descripcion).",
          },
          w: {
            type: Type.STRING,
            description: "Ancho en cm.",
          },
          h: {
            type: Type.STRING,
            description: "Alto en cm.",
          },
          volumenM3: { type: Type.STRING },
          unidad: { type: Type.STRING },
          modelo: {
            type: Type.STRING,
            description:
              "Columna MODELO Magaya: marca/modelo resuelto. Ej: MARCAS=23 → CONCEPTS según tablas. Código o texto que deba ir en MODELO, no en descripcion.",
          },
          paisOrigen: {
            type: Type.STRING,
            description:
              "País de origen en español (ej. CHINA). Mapea códigos PAIS=CH etc.",
          },
          tejido: {
            type: Type.STRING,
            description:
              "Tejido/tela si el documento lo indica; vacío si no hay dato.",
          },
          talla: {
            type: Type.STRING,
            description:
              "Talla o rango min-máx (ej. 12-18 si hay 12,13,...,18).",
          },
          forro: {
            type: Type.STRING,
            description: 'Forro; usa "N/A" salvo que el documento diga otro valor explícito.',
          },
          genero: {
            type: Type.STRING,
            description:
              "Uno de: dama, caballero, niño, niña, bebe; vacío si no aplica. No repetir en descripcion.",
          },
          composicion: {
            type: Type.STRING,
            description:
              "Composición/material legible para columna R Magaya (ej. 015VI → 100% VIDRIO).",
          },
        },
      },
    },
  },
  required: ["reply", "lines"],
};

export type CollectionGeminiLine = {
  referencia?: string;
  descripcion?: string;
  bultos?: string;
  unidadesPorBulto?: string;
  unidadesTotales?: string;
  pesoUnaPiezaKg?: string;
  pesoPorBulto?: string;
  pesoTotalKg?: string;
  l?: string;
  w?: string;
  h?: string;
  volumenM3?: string;
  unidad?: string;
  modelo?: string;
  paisOrigen?: string;
  tejido?: string;
  talla?: string;
  forro?: string;
  genero?: string;
  composicion?: string;
};

export type CollectionGeminiApiResponse = {
  reply: string;
  lines: CollectionGeminiLine[];
};
