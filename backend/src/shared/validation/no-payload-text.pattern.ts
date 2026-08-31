// Texto libre real (nombre/descripción de emprendimiento, categoría) —
// distinto a los campos con formato fijo (cédula, código único, nombre
// completo), acá cualquier texto de negocio válido tiene que pasar: tildes,
// signos de puntuación normales, números, emoji. Lo único que se rechaza es
// lo que NUNCA aparece en una descripción de negocio real y SÍ es la forma
// más común de colar un payload en un campo de texto que después se
// almacena y se vuelve a mostrar: `<`/`>` (tags HTML/script) y las
// plantillas de JS `${...}` / `{{...}}` (template injection). No es
// protección contra XSS por sí sola — Svelte ya escapa al renderizar, y
// Prisma ya parametriza — es una segunda capa: ni siquiera se guarda un
// payload con esta forma, sin importar dónde se use ese texto después.
// Flag "s" (dotAll) a propósito — sin ella, "." no cruza saltos de línea y
// el lookahead solo revisaría la PRIMERA línea de un texto multilínea
// (ej. la descripción de un emprendimiento), dejando pasar un "<script>"
// escrito en la segunda línea sin que el regex lo viera.
export const NO_PAYLOAD_TEXT_PATTERN = /^(?!.*[<>])(?!.*\$\{)(?!.*\{\{).*$/s;
export const NO_PAYLOAD_TEXT_MESSAGE = "Ese texto no puede contener < > ni ${...} — quita esos caracteres";
