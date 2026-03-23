# gemini_updates

Este directorio está pensado para trabajar cómodamente con código generado por Gemini sin ensuciar la base del proyecto.

## Estructura

1. `incoming/`  
   - Aquí pegarás **todo el código generado por Gemini** (archivos sueltos, fragmentos, prototipos, etc.).  
   - La idea es que este sea el área de trabajo "bruta" donde se copia y pega lo que entrega Gemini.

2. `processed/`  
   - Aquí se guardarán las **versiones ya integradas o adaptadas** al proyecto principal.  
   - Puedes usarlo para guardar backups de archivos antes y después de integrarlos en `src/`, o para mantener un historial de iteraciones.

3. `notes/`  
   - Carpeta para **documentar decisiones, cambios y pendientes** relacionados con la integración del código de Gemini.  
   - Puedes usar archivos Markdown para registrar qué se cambió, por qué y en qué fecha.

## Flujo de trabajo recomendado

1. Pegar código generado por Gemini dentro de `incoming/`.
2. Indicar explícitamente a Cursor que debe trabajar **solo sobre el código en `incoming/`** para:
   - Limpiar, adaptar y revisar el código.
   - Integrarlo cuidadosamente en `src/` (app, components, lib, etc.).
3. Cuando una versión esté integrada o lista, mover/copiar el resultado a `processed/` como referencia.
4. Documentar en `notes/` cualquier decisión relevante, dudas, o tareas futuras.

Importante: hasta que no pegues código en `incoming/` y des la instrucción explícita, este proyecto se mantiene con **pantallas temporales** y sin interfaces finales.

