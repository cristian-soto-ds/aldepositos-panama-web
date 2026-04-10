import { Type } from "@google/genai";

/** Salida JSON forzada del modelo: texto + líneas para la tabla de recolección */
export const collectionGeminiResponseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        "Respuesta conversacional en español: resume lo encontrado, dudas o advertencias.",
    },
    lines: {
      type: Type.ARRAY,
      description:
        "Filas extraídas del documento o del mensaje. Una fila por referencia/código de pieza. Cadenas vacías si no aplica.",
      items: {
        type: Type.OBJECT,
        properties: {
          referencia: { type: Type.STRING },
          descripcion: { type: Type.STRING },
          bultos: { type: Type.STRING },
          unidadesPorBulto: {
            type: Type.STRING,
            description:
              "Unidades por bulto como ENTEROS (nunca docenas: 1 docena = 12 unidades).",
          },
          unidadesTotales: {
            type: Type.STRING,
            description:
              "Si el documento solo da total de piezas, pon aquí el total en unidades (entero). Vacío si ya diste unidadesPorBulto.",
          },
          pesoPorBulto: {
            type: Type.STRING,
            description:
              "Peso por bulto en kg cuando el documento lo indique. Si solo hay peso total de línea, déjalo vacío y usa pesoTotalKg.",
          },
          pesoTotalKg: {
            type: Type.STRING,
            description:
              "Peso total de la línea en kg. Obligatorio rellenarlo cuando el documento lo muestre o cuando puedas calcularlo (bultos × peso por bulto en kg). Si das peso total y bultos, el sistema reparte en peso por bulto.",
          },
          l: { type: Type.STRING },
          w: { type: Type.STRING },
          h: { type: Type.STRING },
          volumenM3: { type: Type.STRING },
          unidad: { type: Type.STRING },
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
  pesoPorBulto?: string;
  pesoTotalKg?: string;
  l?: string;
  w?: string;
  h?: string;
  volumenM3?: string;
  unidad?: string;
};

export type CollectionGeminiApiResponse = {
  reply: string;
  lines: CollectionGeminiLine[];
};
