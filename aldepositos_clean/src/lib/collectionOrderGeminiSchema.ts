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
          descripcion: {
            type: Type.STRING,
            description:
              "Nombre del artículo SIN medidas ni dimensiones en texto (no '10X10X10CM'). SIN género (no dama/caballero); el género va en campo genero. Ej: ESFERA, JIRAFA DECOR, PANTALON JEANS.",
          },
          bultos: { type: Type.STRING },
          unidadesPorBulto: {
            type: Type.STRING,
            description:
              "Piezas dentro de UN bulto/caja, ENTEROS. Convierte pares (1 par=2), docenas (=12), medias docenas (=6), etc.",
          },
          unidadesTotales: {
            type: Type.STRING,
            description:
              "Si el documento solo da total de piezas de la línea, total en unidades (entero). Vacío si ya diste unidadesPorBulto.",
          },
          pesoUnaPiezaKg: {
            type: Type.STRING,
            description:
              "Peso en kg de UNA sola pieza (artículo). Obligatorio cuando haya dato de peso: si el doc da peso por bulto, divide entre unidades por bulto. Es el valor de la columna PESO del CSV Magaya.",
          },
          pesoPorBulto: {
            type: Type.STRING,
            description:
              "Peso del bulto completo en kg si el documento lo separa; si no, puedes dejar vacío si ya diste pesoUnaPiezaKg y unidadesPorBulto.",
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
