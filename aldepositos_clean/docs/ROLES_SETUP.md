# Roles de panel — checklist Supabase

La app lee la columna **`rol`** en `public.profiles` o `public.perfiles` (la que exista).

## Valores

| Valor | Quién | Menú |
|--------|--------|------|
| `admin` | Supervisión / oficina | Todo el panel |
| `inventariador` | Operarios de piso | Inventarios, Registro fotográfico, Ranking inventariadores, Opciones de usuario |

Escribí siempre en **minúsculas**. Default al crear la columna: `admin`.

## 1. Crear la columna (una sola vez)

Supabase → **SQL Editor** → pegá y ejecutá el contenido de  
[`supabase/migrations/015_profiles_rol.sql`](../supabase/migrations/015_profiles_rol.sql).

## 2. Asignar inventariadores

1. **Table Editor** → tabla `profiles` (o `perfiles`).
2. Localizá la fila del usuario (mismo `id` que en **Authentication → Users**, o por correo).
3. En la columna **`rol`**, poné exactamente: `inventariador`.
4. Guardá.
5. El usuario debe **cerrar sesión y volver a entrar** (o recargar el panel).

Ejemplo SQL para un correo concreto:

```sql
update public.profiles
set rol = 'inventariador'
where id = (
  select id from auth.users
  where email = 'inventario1@aldepositospanama.com'
  limit 1
);
```

Si usás `perfiles` en lugar de `profiles`, cambiá el nombre de la tabla.

## 3. Dejar admins

Quienes deben ver el panel completo:

```sql
update public.profiles
set rol = 'admin'
where id = 'UUID-DEL-USUARIO';
```

O editá `rol = admin` a mano en Table Editor.

## 4. Verificar

1. Login con un usuario `inventariador` → solo 4 ítems en el menú; abre en **Inventarios**.
2. Login con `admin` → menú completo.

## Notas

- El rol **no** se configura en Auth → Users; solo en la fila de perfil.
- Por ahora el rol limita la **UI** (menú). Los inventariadores siguen pudiendo leer/escribir RA en Supabase como antes.
- Roles futuros (recepcionista, etc.) se agregan con el mismo patrón en `rol` + lista de vistas en `src/lib/userRole.ts`.
