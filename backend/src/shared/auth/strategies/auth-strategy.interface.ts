// Interfaz base del patrón Strategy para los flujos de login. Intencionalmente
// vacía de métodos concretos: los tres flujos (OIDC/redirect, social embebido,
// correo/OTP) no comparten una firma de método porque sus pares de endpoints
// HTTP tienen parámetros distintos. Lo que comparten es la pertenencia a esta
// familia — útil para DI, testing y razonamiento sobre el módulo.
export interface AuthStrategy {
  readonly name: string;
}
