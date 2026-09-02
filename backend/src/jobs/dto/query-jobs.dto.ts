import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { NO_PAYLOAD_TEXT_MESSAGE, NO_PAYLOAD_TEXT_PATTERN } from "../../shared/validation/no-payload-text.pattern";

export const JOB_KINDS = ["INTERNSHIP", "FULL_TIME", "PART_TIME", "CONTRACT"] as const;
export const JOB_WORK_MODES = ["ONSITE", "HYBRID", "REMOTE"] as const;
export const JOB_SENIORITIES = ["INTERN", "JUNIOR", "MID", "SENIOR", "UNKNOWN"] as const;
export const JOB_SORTS = ["relevance", "recent"] as const;

/**
 * Filtros del listado público de ofertas.
 *
 * Todo llega por query string, así que todo llega como string — de ahí los
 * `@Transform`. Sin ellos, `?remote=false` entraba como la cadena "false",
 * que en JS es truthy, y el filtro hacía exactamente lo contrario de lo
 * pedido.
 */
export class QueryJobsDto {
  /**
   * Búsqueda libre.
   *
   * Pasa por `NoPayloadText` como el resto de campos de texto libre de la
   * app: aunque acá el valor va a un `contains` de Prisma (parametrizado,
   * sin riesgo de inyección SQL), el mismo texto se refleja en la respuesta
   * y de ahí a la UI. La regla del proyecto es que ningún texto libre entre
   * sin ese filtro, y una excepción "porque este caso es seguro" es
   * justamente como se cuelan los que no lo son.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(NO_PAYLOAD_TEXT_PATTERN, { message: NO_PAYLOAD_TEXT_MESSAGE })
  q?: string;

  @IsOptional()
  @IsIn(JOB_KINDS)
  kind?: (typeof JOB_KINDS)[number];

  @IsOptional()
  @IsIn(JOB_WORK_MODES)
  workMode?: (typeof JOB_WORK_MODES)[number];

  @IsOptional()
  @IsIn(JOB_SENIORITIES)
  seniority?: (typeof JOB_SENIORITIES)[number];

  /** Solo ofertas alcanzables desde Ecuador (locales + remotas). */
  @IsOptional()
  @Transform(({ value }) => toBool(value))
  @IsBoolean()
  ecuador?: boolean;

  /** Etiqueta de stack exacta, como la devuelve el motor ("Java", "React"). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(NO_PAYLOAD_TEXT_PATTERN, { message: NO_PAYLOAD_TEXT_MESSAGE })
  tag?: string;

  @IsOptional()
  @IsIn(JOB_SORTS)
  sort?: (typeof JOB_SORTS)[number];

  /**
   * Tope duro de 100 por página.
   *
   * Sin tope, `?limit=100000` convertía el endpoint público en una
   * herramienta de DoS gratis contra la base: sin auth, cacheable por
   * nadie, y con un `contains` encima.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

// "false"/"0"/"no" son falsos; el resto de valores presentes, verdaderos.
// Un `?ecuador` sin valor (cadena vacía) cuenta como true, que es lo que
// espera cualquiera que escriba la URL a mano.
function toBool(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "true" || v === "1" || v === "si") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return value; // deja que @IsBoolean lo rechace con un mensaje claro
}
