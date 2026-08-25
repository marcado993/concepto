import { IsIn } from "class-validator";

export class UpdateUiVariantDto {
  @IsIn(["A", "B"], { message: 'variant debe ser "A" (rueda) o "B" (fila)' })
  variant!: "A" | "B";
}
