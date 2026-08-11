import { IsIn, IsString } from "class-validator";
import { PaymentMethod } from "../rental-calculator";

export class RentLockerDto {
  @IsString()
  lockerCode!: string;

  @IsIn(["TRANSFER", "PAYPHONE"] satisfies PaymentMethod[])
  method!: PaymentMethod;
}
