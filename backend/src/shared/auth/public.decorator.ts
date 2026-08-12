import { SetMetadata } from "@nestjs/common";

// DRY: un solo mecanismo de excepción a la autenticación global (APP_GUARD
// en auth.module.ts). Sin esto, cada endpoint público (login, callback,
// datos de seguridad sin PII) necesitaría su propio guard a medida.
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
