# Línea familiar

App de árbol genealógico con parentescos calculados automáticamente.
Vanilla JS + Supabase, pensada para desplegar en GitHub Pages — el mismo
flujo que ya usas en OPOTEST.

## 1. Crear el proyecto en Supabase

1. Ve a https://supabase.com y crea un proyecto nuevo (gratis).
2. Dentro del proyecto: **SQL Editor** → *New query* → pega el contenido de
   `supabase-schema.sql` → **Run**. Esto crea la tabla `families`.
3. Ve a **Settings → API** y copia:
   - **Project URL**
   - **anon public** key.

## 2. Configurar la app

Abre `config.js` y pega ahí esos dos valores:

```js
const SUPABASE_URL = "https://tuproyecto.supabase.co";
const SUPABASE_ANON_KEY = "eyJ...";
```

## 3. Probarlo en local

Puedes abrir `index.html` directamente en el navegador, o si prefieres un
servidor local (recomendable para evitar problemas de CORS con algunos
navegadores):

```bash
npx serve .
```

## 4. Desplegar en GitHub Pages

Igual que con OPOTEST:

1. Sube esta carpeta a un repositorio de GitHub.
2. Repositorio → **Settings → Pages** → Source: rama `main`, carpeta `/root`.
3. En un par de minutos tendrás la URL pública (algo como
   `https://tuusuario.github.io/linea-familiar/`).

## Cómo funciona

- Cada familia es una fila en la tabla `families`, guardada como JSON bajo
  un **código** que tú eliges al crearla (ej. `paez2024`). Compártelo con tu
  familia para que puedan entrar y añadirse.
- El parentesco de cada persona (tío, primo, cuñado...) se calcula solo a
  partir de quién es hijo/a de quién — no hay que escribirlo a mano.
- El dispositivo recuerda tu código de familia y quién eres tú (guardado en
  el navegador) así que no hace falta volver a entrar cada vez.

## Limitaciones actuales (siguientes pasos naturales)

- No hay edición ni borrado de personas ya añadidas.
- No hay fotos, ubicaciones ni línea temporal por año todavía — eso lo
  añadimos encima de este árbol cuando quieras.
- La seguridad es "quien tiene el código, entra" — suficiente para una
  familia, pero no es autenticación real. Supabase Auth sería el salto
  natural si algún día quieres cuentas individuales con contraseña propia.
